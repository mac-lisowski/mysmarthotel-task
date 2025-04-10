import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from './task.controller';
import { TaskService } from '../services/task.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { ApiKeyGuard } from '../../../common/guards/api-key.guard';
import { QueryBus } from '@nestjs/cqrs';
import { NotFoundException, StreamableFile } from '@nestjs/common';
import { GetFailedTaskErrorReportQuery } from '../queries/get-failed-task-error-report.query';
import { Response } from 'express';

describe('TaskController', () => {
    let controller: TaskController;
    let taskService: TaskService;
    let queryBus: QueryBus;

    const mockTaskService = {
        handleFileChunk: jest.fn(),
    };

    const mockQueryBus = {
        execute: jest.fn(),
    };

    const mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn(() => mockResponse),
        send: jest.fn(),
    } as unknown as Response;

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
                {
                    provide: QueryBus,
                    useValue: mockQueryBus,
                },
            ],
        }).compile();

        controller = module.get<TaskController>(TaskController);
        taskService = module.get<TaskService>(TaskService);
        queryBus = module.get<QueryBus>(QueryBus);

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

    describe('getTaskErrorReport', () => {
        const taskId = uuidv4();
        const originalFileName = 'failed_upload.xlsx';
        const mockErrors = [
            { row: 2, error: 'Invalid date format' },
            { row: 5, error: 'Missing required field: guest_name"' }, // Test escaping
            { row: undefined, error: 'File processing error' },
        ];

        it('should return a StreamableFile with CSV content for a failed task', async () => {
            mockQueryBus.execute.mockResolvedValueOnce({
                errors: mockErrors,
                originalFileName: originalFileName,
            });

            const result = await controller.getTaskErrorReport(taskId, mockResponse);

            expect(mockQueryBus.execute).toHaveBeenCalledWith(new GetFailedTaskErrorReportQuery(taskId));
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
            expect(mockResponse.setHeader).toHaveBeenCalledWith(
                'Content-Disposition',
                `attachment; filename="error_report_failed_upload.xlsx.csv"`
            );
            expect(result).toBeInstanceOf(StreamableFile);

            const buffer = await new Promise<Buffer>((resolve, reject) => {
                const stream = result.getStream();
                const chunks: Buffer[] = [];
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
            const csvString = buffer.toString('utf-8');
            expect(csvString).toContain('"Row","Error"\n');
            expect(csvString).toContain('"2","Invalid date format"\n');
            expect(csvString).toContain('"5","Missing required field: guest_name"""\n');
            expect(csvString).toContain('"N/A","File processing error"');
        });

        it('should throw NotFoundException if task is not found or not FAILED', async () => {
            const errorMessage = `Error report is only available for tasks with status FAILED.`;
            mockQueryBus.execute.mockRejectedValueOnce(new NotFoundException(errorMessage));

            await expect(controller.getTaskErrorReport(taskId, mockResponse)).rejects.toThrow(NotFoundException);

            expect(mockQueryBus.execute).toHaveBeenCalledWith(new GetFailedTaskErrorReportQuery(taskId));
            expect(mockResponse.setHeader).not.toHaveBeenCalled();
        });

        it('should throw original error if query execution fails with a generic error', async () => {
            const genericError = new Error('Database connection lost');
            mockQueryBus.execute.mockRejectedValueOnce(genericError);

            await expect(controller.getTaskErrorReport(taskId, mockResponse)).rejects.toThrow(genericError);

            expect(mockQueryBus.execute).toHaveBeenCalledWith(new GetFailedTaskErrorReportQuery(taskId));
            expect(mockResponse.setHeader).not.toHaveBeenCalled();
        });
    });
}); 