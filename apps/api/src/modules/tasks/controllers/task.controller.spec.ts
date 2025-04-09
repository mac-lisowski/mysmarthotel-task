import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from './task.controller';
import { TaskService } from '../services/task.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { ApiKeyGuard } from '../../../common/guards/api-key.guard';

describe('TaskController', () => {
    let controller: TaskController;
    let taskService: TaskService;

    const mockTaskService = {
        handleFileChunk: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [TaskController],
            providers: [
                {
                    provide: TaskService,
                    useValue: mockTaskService,
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn(),
                    },
                },
                {
                    provide: ApiKeyGuard,
                    useValue: { canActivate: () => true },
                },
            ],
        }).compile();

        controller = module.get<TaskController>(TaskController);
        taskService = module.get<TaskService>(TaskService);

        jest.clearAllMocks();
    });

    describe('uploadFile', () => {
        const mockFile = {
            fieldname: 'file',
            originalname: 'test.xlsx',
            encoding: '7bit',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: Buffer.from('test'),
            size: 4,
        } as Express.Multer.File;

        const mockUploadId = uuidv4();
        const mockOriginalFileName = 'test.xlsx';

        it('should handle intermediate chunk upload', async () => {
            const mockDto = {
                chunkNumber: 0,
                totalChunks: 2,
                uploadId: mockUploadId,
                originalFileName: mockOriginalFileName,
            };

            mockTaskService.handleFileChunk.mockResolvedValueOnce({
                status: 'chunk_received',
            });

            const result = await controller.uploadFile(mockFile, mockDto);

            expect(result).toEqual({ status: 'chunk_received' });
            expect(taskService.handleFileChunk).toHaveBeenCalledWith(
                mockFile,
                mockDto.chunkNumber,
                mockDto.totalChunks,
                mockDto.uploadId,
                mockDto.originalFileName,
            );
        });

        it('should handle final chunk upload and return task ID', async () => {
            const mockDto = {
                chunkNumber: 1,
                totalChunks: 2,
                uploadId: mockUploadId,
                originalFileName: mockOriginalFileName,
            };

            const mockTaskId = uuidv4();
            mockTaskService.handleFileChunk.mockResolvedValueOnce({
                taskId: mockTaskId,
            });

            const result = await controller.uploadFile(mockFile, mockDto);

            expect(result).toEqual({ taskId: mockTaskId });
            expect(taskService.handleFileChunk).toHaveBeenCalledWith(
                mockFile,
                mockDto.chunkNumber,
                mockDto.totalChunks,
                mockDto.uploadId,
                mockDto.originalFileName,
            );
        });
    });
}); 