import { Test, TestingModule } from '@nestjs/testing';
import { TaskService } from './task.service';
import { FileService } from '@files';
import { CommandBus } from '@nestjs/cqrs';
import Redis from 'ioredis';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CreateTaskCommand } from '../commands/create-task.command';

describe('TaskService', () => {
    let service: TaskService;
    let fileService: jest.Mocked<FileService>;
    let commandBus: jest.Mocked<CommandBus>;
    let redis: jest.Mocked<Redis>;

    const mockFile = {
        buffer: Buffer.from('test data'),
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File;

    beforeEach(async () => {
        const mockFileService = {
            createMultipartUpload: jest.fn(),
            uploadPart: jest.fn(),
            completeMultipartUpload: jest.fn(),
            abortMultipartUpload: jest.fn(),
        };

        const mockRedis = {
            get: jest.fn(),
            set: jest.fn(),
            multi: jest.fn(),
            exec: jest.fn(),
        };

        mockRedis.multi.mockReturnValue({
            set: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: mockRedis.exec,
        });

        const mockCommandBus = {
            execute: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TaskService,
                {
                    provide: FileService,
                    useValue: mockFileService,
                },
                {
                    provide: 'default_IORedisModuleConnectionToken',
                    useValue: mockRedis,
                },
                {
                    provide: CommandBus,
                    useValue: mockCommandBus,
                },
            ],
        }).compile();

        service = module.get<TaskService>(TaskService);
        fileService = module.get(FileService);
        redis = module.get('default_IORedisModuleConnectionToken');
        commandBus = module.get(CommandBus);
    });

    describe('handleFileChunk', () => {
        const uploadId = uuidv4();
        const originalFileName = 'test.xlsx';
        const s3UploadId = 'mock-s3-upload-id';
        const bucketFilePath = `uploads/${uploadId}/${originalFileName}`;

        it('should handle first chunk (chunkNumber = 0) correctly', async () => {
            // Mock S3 multipart upload initiation
            fileService.createMultipartUpload.mockResolvedValueOnce(s3UploadId);
            fileService.uploadPart.mockResolvedValueOnce('etag1');
            redis.exec.mockResolvedValueOnce([[null, 'OK'], [null, 'OK']]);

            const result = await service.handleFileChunk(
                mockFile,
                0,
                2,
                uploadId,
                originalFileName,
            );

            expect(fileService.createMultipartUpload).toHaveBeenCalledWith(
                expect.stringContaining('uploads/'),
                mockFile.mimetype,
            );
            expect(fileService.uploadPart).toHaveBeenCalledWith(
                expect.any(String),
                s3UploadId,
                1,
                mockFile.buffer,
            );
            expect(redis.multi).toHaveBeenCalled();
            expect(result).toEqual({ status: 'chunk_received' });
        });

        it('should handle intermediate chunk correctly', async () => {
            const mockSession = {
                s3UploadId,
                bucketFilePath,
                totalChunks: 3,
                originalFileName,
                mimeType: mockFile.mimetype,
                uploadedParts: [{ PartNumber: 1, ETag: 'etag1' }],
            };

            redis.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            fileService.uploadPart.mockResolvedValueOnce('etag2');
            redis.set.mockResolvedValueOnce('OK');

            const result = await service.handleFileChunk(
                mockFile,
                1,
                3,
                uploadId,
                originalFileName,
            );

            expect(redis.get).toHaveBeenCalledWith(`upload:${uploadId}`);
            expect(fileService.uploadPart).toHaveBeenCalledWith(
                bucketFilePath,
                s3UploadId,
                2,
                mockFile.buffer,
            );
            expect(result).toEqual({ status: 'chunk_received' });
        });

        it('should handle final chunk and complete upload', async () => {
            const mockSession = {
                s3UploadId,
                bucketFilePath,
                totalChunks: 2,
                originalFileName,
                mimeType: mockFile.mimetype,
                uploadedParts: [{ PartNumber: 1, ETag: 'etag1' }],
            };

            const mockTaskId = uuidv4();

            redis.get.mockResolvedValueOnce(JSON.stringify(mockSession));
            fileService.uploadPart.mockResolvedValueOnce('etag2');
            fileService.completeMultipartUpload.mockResolvedValueOnce('finalETag');
            commandBus.execute.mockResolvedValueOnce(mockTaskId);
            redis.set.mockResolvedValueOnce('OK');

            const result = await service.handleFileChunk(
                mockFile,
                1,
                2,
                uploadId,
                originalFileName,
            );

            expect(fileService.completeMultipartUpload).toHaveBeenCalledWith(
                bucketFilePath,
                s3UploadId,
                expect.arrayContaining([
                    { PartNumber: 1, ETag: 'etag1' },
                    { PartNumber: 2, ETag: 'etag2' },
                ]),
            );
            expect(commandBus.execute).toHaveBeenCalledWith(
                expect.any(CreateTaskCommand),
            );
            expect(result).toEqual({ taskId: mockTaskId });
        });

        it('should throw BadRequestException when session not found', async () => {
            redis.get.mockResolvedValueOnce(null);

            await expect(
                service.handleFileChunk(mockFile, 1, 2, uploadId, originalFileName),
            ).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException when chunk number exceeds total chunks', async () => {
            await expect(
                service.handleFileChunk(mockFile, 2, 2, uploadId, originalFileName),
            ).rejects.toThrow(BadRequestException);
        });

        it('should handle S3 upload errors gracefully', async () => {
            fileService.createMultipartUpload.mockRejectedValueOnce(new Error('S3 Error'));

            await expect(
                service.handleFileChunk(mockFile, 0, 2, uploadId, originalFileName),
            ).rejects.toThrow(InternalServerErrorException);
        });
    });
}); 