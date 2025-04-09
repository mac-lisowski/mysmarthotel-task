import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from './task.controller';
import { TaskService } from '../services/task.service';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

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
            ],
        }).compile();

        controller = module.get<TaskController>(TaskController);
        taskService = module.get<TaskService>(TaskService);

        // Reset mock before each test
        jest.clearAllMocks();
    });

    describe('uploadFile', () => {
        it('should handle file chunks correctly', async () => {
            const mockFileContent = Buffer.from('Mock XLSX content');
            const chunkSize = 5;
            const totalChunks = Math.ceil(mockFileContent.length / chunkSize);
            const uploadId = uuidv4();

            // Mock service responses
            for (let i = 0; i < totalChunks - 1; i++) {
                mockTaskService.handleFileChunk.mockResolvedValueOnce({ completed: false });
            }
            mockTaskService.handleFileChunk.mockResolvedValueOnce({ completed: true });

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, mockFileContent.length);
                const chunk = mockFileContent.slice(start, end);

                const mockFile: Express.Multer.File = {
                    buffer: chunk,
                    fieldname: 'file',
                    originalname: 'test.xlsx',
                    encoding: '7bit',
                    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    size: chunk.length,
                    stream: new Readable(),
                    destination: '',
                    filename: '',
                    path: '',
                };

                const dto = {
                    chunkNumber: i,
                    totalChunks,
                    uploadId,
                    originalFileName: 'test.xlsx',
                };

                const result = await controller.uploadFile(mockFile, dto);

                // Verify service was called with correct parameters
                expect(mockTaskService.handleFileChunk).toHaveBeenCalledWith(
                    mockFile,
                    i,
                    totalChunks,
                    uploadId,
                    'test.xlsx'
                );

                // Verify expected completion status
                if (i < totalChunks - 1) {
                    expect(result.completed).toBe(false);
                } else {
                    expect(result.completed).toBe(true);
                }
            }

            // Verify total number of service calls
            expect(mockTaskService.handleFileChunk).toHaveBeenCalledTimes(totalChunks);
        });

        it('should handle single chunk upload', async () => {
            const uploadId = uuidv4();
            mockTaskService.handleFileChunk.mockResolvedValueOnce({ completed: true });

            const mockFile: Express.Multer.File = {
                buffer: Buffer.from('Small XLSX content'),
                fieldname: 'file',
                originalname: 'test.xlsx',
                encoding: '7bit',
                mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: 17,
                stream: new Readable(),
                destination: '',
                filename: '',
                path: '',
            };

            const dto = {
                chunkNumber: 0,
                totalChunks: 1,
                uploadId,
                originalFileName: 'test.xlsx',
            };

            const result = await controller.uploadFile(mockFile, dto);

            // Verify service was called with correct parameters
            expect(mockTaskService.handleFileChunk).toHaveBeenCalledWith(
                mockFile,
                0,
                1,
                uploadId,
                'test.xlsx'
            );
            expect(result.completed).toBe(true);
            expect(mockTaskService.handleFileChunk).toHaveBeenCalledTimes(1);
        });
    });
}); 