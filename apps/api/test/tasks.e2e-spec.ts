import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { ApiModule } from '../src/api.module';
import { v4 as uuidv4 } from 'uuid';
import { Connection, Model } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Task, TaskDocument, TaskStatus, Event, EventDocument, EventStatus } from '@database';
import { useContainer } from 'class-validator';

describe('TaskController (e2e)', () => {
    let app: INestApplication;
    let mongooseConnection: Connection;
    let taskModel: Model<TaskDocument>;
    let eventModel: Model<EventDocument>;
    let apiKey: string;

    beforeAll(async () => {
        apiKey = process.env.API_ROOT_API_KEY as string;
        if (!apiKey) {
            throw new Error('API_ROOT_API_KEY not set. Ensure globalSetup ran.');
        }

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [ApiModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        mongooseConnection = moduleFixture.get<Connection>(getConnectionToken());
        taskModel = moduleFixture.get<Model<TaskDocument>>(getModelToken(Task.name));
        eventModel = moduleFixture.get<Model<EventDocument>>(getModelToken(Event.name));

        app.setGlobalPrefix('v1');

        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
                whitelist: true,
            }),
        );

        useContainer(app.select(ApiModule), { fallbackOnErrors: true });

        await app.init();
    });

    afterAll(async () => {
        if (mongooseConnection) {
            await taskModel.deleteMany({}).exec();
            await eventModel.deleteMany({}).exec();
            await mongooseConnection.close();
        }
        if (app) {
            await app.close();
        }

        if (global.__WORKER_PROCESS__) {
            try {
                global.__WORKER_PROCESS__.kill('SIGTERM');
            } catch (err) {
                console.warn('Error during worker cleanup:', err);
            }
        }
    });

    async function createTestTask(status: TaskStatus = TaskStatus.PENDING, errors: Record<string, any>[] = []): Promise<TaskDocument> {
        const task = await taskModel.create({
            taskId: uuidv4(),
            filePath: '/test/path/file.xlsx',
            originalFileName: 'test-file.xlsx',
            status,
            errors,
            startedAt: status === TaskStatus.IN_PROGRESS ? new Date() : undefined,
            completedAt: (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) ? new Date() : undefined,
        });
        return task;
    }

    async function waitForEventStatus(
        taskId: string,
        expectedStatus: EventStatus,
        timeoutMs: number = 15000,
        pollIntervalMs: number = 500
    ): Promise<boolean> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const event = await eventModel.findOne({
                'event.payload.taskId': taskId,
                'eventName': 'task.created.event',
                status: { $in: [expectedStatus, EventStatus.PROCESSED] }
            }).lean().exec();

            if (event) {
                if (expectedStatus === EventStatus.PUBLISHED && event.status === EventStatus.PROCESSED) {
                    return true;
                }
                if (event.status === expectedStatus) {
                    return true;
                }
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        console.warn(`Timeout waiting for event for task ${taskId} to reach status ${expectedStatus}`);
        const allEvents = await eventModel.find({}).lean().exec();
        console.warn('Current events in database:', JSON.stringify(allEvents, null, 2));
        return false;
    }

    async function waitForTaskStatus(
        taskId: string,
        expectedStatus: TaskStatus,
        timeoutMs: number = 15000,
        pollIntervalMs: number = 500
    ): Promise<boolean> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const task = await taskModel.findOne({ taskId }).lean().exec();
            if (task?.status === expectedStatus) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        console.warn(`Timeout waiting for task ${taskId} to reach status ${expectedStatus}`);
        const task = await taskModel.findOne({ taskId }).lean().exec();
        console.warn('Current task state:', JSON.stringify(task, null, 2));
        return false;
    }

    describe('/v1/task/upload (POST)', () => {
        it('should upload file in chunks and create task entry', async () => {
            const filePath = path.join(__dirname, 'fixtures', 'reservations.xlsx');
            const originalFileName = 'reservations.xlsx';
            const fileSize = fs.statSync(filePath).size;
            const chunkSize = 1 * 1024 * 1024;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
            const uploadId = uuidv4();
            let chunkNumber = 0;
            let receivedTaskId: string | null = null;

            for await (const chunk of fileStream) {
                const isLastChunk = chunkNumber === totalChunks - 1;

                const response = await request(app.getHttpServer())
                    .post('/v1/task/upload')
                    .set('x-api-key', apiKey)
                    .attach('file', chunk, {
                        filename: `chunk-${chunkNumber}.bin`,
                        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    })
                    .field('uploadId', uploadId)
                    .field('originalFileName', originalFileName)
                    .field('chunkNumber', chunkNumber)
                    .field('totalChunks', totalChunks)
                    .expect(isLastChunk ? 201 : 200);

                if (isLastChunk) {
                    expect(response.body).toHaveProperty('taskId');
                    receivedTaskId = response.body.taskId;
                    expect(typeof receivedTaskId).toBe('string');
                } else {
                    expect(response.body).toEqual({ status: 'chunk_received' });
                }
                chunkNumber++;
            }

            expect(chunkNumber).toEqual(totalChunks);
            expect(receivedTaskId).not.toBeNull();

            const foundTask = await taskModel.findOne({ taskId: receivedTaskId }).lean().exec();
            expect(foundTask).toBeDefined();
            expect(foundTask).not.toBeNull();

            if (foundTask) {
                expect(foundTask.taskId).toEqual(receivedTaskId);
                expect(foundTask.originalFileName).toEqual(originalFileName);
                expect(foundTask.status).toEqual(TaskStatus.PENDING);
                expect(foundTask.filePath).toBeDefined();
                expect(typeof foundTask.filePath).toBe('string');
                expect(foundTask.filePath).toContain(originalFileName);
                expect(foundTask.createdAt).toBeInstanceOf(Date);
                expect(foundTask.updatedAt).toBeInstanceOf(Date);
            }
        });

        it('should return 401 for invalid API key', async () => {
            await request(app.getHttpServer())
                .post('/v1/task/upload')
                .set('x-api-key', 'invalid-key')
                .attach('file', Buffer.from('test'), {
                    filename: 'test.xlsx',
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                })
                .field('uploadId', uuidv4())
                .field('originalFileName', 'test.xlsx')
                .field('chunkNumber', 0)
                .field('totalChunks', 1)
                .expect(401);
        });

        it('should return 400 for invalid file type', async () => {
            await request(app.getHttpServer())
                .post('/v1/task/upload')
                .set('x-api-key', apiKey)
                .attach('file', Buffer.from('test'), {
                    filename: 'test.txt',
                    contentType: 'text/plain'
                })
                .field('uploadId', uuidv4())
                .field('originalFileName', 'test.txt')
                .field('chunkNumber', 0)
                .field('totalChunks', 1)
                .expect(400);
        });

        it('should return 400 for missing fields', async () => {
            await request(app.getHttpServer())
                .post('/v1/task/upload')
                .set('x-api-key', apiKey)
                .attach('file', Buffer.from('test'), {
                    filename: 'test.xlsx',
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                })
                .expect(400);
        });

        it('should return 400 for chunk number out of bounds', async () => {
            await request(app.getHttpServer())
                .post('/v1/task/upload')
                .set('x-api-key', apiKey)
                .attach('file', Buffer.from('test'), {
                    filename: 'test.xlsx',
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                })
                .field('uploadId', uuidv4())
                .field('originalFileName', 'test.xlsx')
                .field('chunkNumber', 5)
                .field('totalChunks', 3)
                .expect(400);
        });

        it('should return 400 for invalid uploadId format', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/task/upload')
                .set('x-api-key', apiKey)
                .field('uploadId', 'not-a-uuid')
                .field('originalFileName', 'test.xlsx')
                .field('chunkNumber', '0')
                .field('totalChunks', '1')
                .attach('file', Buffer.from('test'), {
                    filename: 'test.xlsx',
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                })
                .expect(400)
                .expect(res => {
                    expect(res.body.message).toEqual(expect.arrayContaining([
                        expect.stringContaining('uploadId')
                    ]));
                });
        });

        it('should trigger worker event publishing', async () => {
            const filePath = path.join(__dirname, 'fixtures', 'reservations.xlsx');
            const originalFileName = 'reservations_worker_test.xlsx';
            const fileSize = fs.statSync(filePath).size;
            const chunkSize = 1 * 1024 * 1024;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
            const uploadId = uuidv4();
            let chunkNumber = 0;
            let receivedTaskId: string | null = null;

            for await (const chunk of fileStream) {
                const isLastChunk = chunkNumber === totalChunks - 1;
                const response = await request(app.getHttpServer())
                    .post('/v1/task/upload')
                    .set('x-api-key', apiKey)
                    .attach('file', chunk, { filename: `chunk-${chunkNumber}.bin`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
                    .field('uploadId', uploadId)
                    .field('originalFileName', originalFileName)
                    .field('chunkNumber', chunkNumber)
                    .field('totalChunks', totalChunks);
                if (isLastChunk) {
                    receivedTaskId = response.body.taskId;
                }
                chunkNumber++;
            }
            console.log(`Upload complete. Task ID: ${receivedTaskId}. Waiting for event processing...`);
            expect(receivedTaskId).toBeDefined();
            expect(receivedTaskId).not.toBeNull();

            const processed = await waitForEventStatus(receivedTaskId!, EventStatus.PROCESSED);
            expect(processed).toBe(true);
        });
    });

    describe('/v1/task/status/:taskId (GET)', () => {
        it('should return 404 for non-existent taskId', async () => {
            const nonExistentTaskId = uuidv4();
            await request(app.getHttpServer())
                .get(`/v1/task/status/${nonExistentTaskId}`)
                .set('x-api-key', apiKey)
                .expect(404)
                .expect(res => {
                    expect(res.body.message).toContain(nonExistentTaskId);
                });
        });

        it('should return 401 for invalid API key', async () => {
            const task = await createTestTask();
            await request(app.getHttpServer())
                .get(`/v1/task/status/${task.taskId}`)
                .set('x-api-key', 'invalid-key')
                .expect(401);
        });

        it('should return task status for valid taskId', async () => {
            const task = await createTestTask(TaskStatus.FAILED, [
                { row: 1, error: 'Invalid date format' },
                { row: 5, error: 'Missing required field' }
            ]);

            const response = await request(app.getHttpServer())
                .get(`/v1/task/status/${task.taskId}`)
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toMatchObject({
                taskId: task.taskId,
                status: TaskStatus.FAILED,
                originalFileName: task.originalFileName,
                errors: expect.arrayContaining([
                    expect.objectContaining({ row: 1, error: 'Invalid date format' }),
                    expect.objectContaining({ row: 5, error: 'Missing required field' })
                ])
            });
            expect(response.body.createdAt).toBeDefined();
            expect(response.body.updatedAt).toBeDefined();
            expect(response.body.completedAt).toBeDefined();
        });

        it('should return task status for processing task', async () => {
            const task = await createTestTask(TaskStatus.IN_PROGRESS);

            const response = await request(app.getHttpServer())
                .get(`/v1/task/status/${task.taskId}`)
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toMatchObject({
                taskId: task.taskId,
                status: TaskStatus.IN_PROGRESS,
                originalFileName: task.originalFileName,
                errors: [],
                completedAt: null
            });
            expect(response.body.startedAt).toBeDefined();
        });

        it('should return task status for completed task', async () => {
            const task = await createTestTask(TaskStatus.COMPLETED);

            const response = await request(app.getHttpServer())
                .get(`/v1/task/status/${task.taskId}`)
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.body).toMatchObject({
                taskId: task.taskId,
                status: TaskStatus.COMPLETED,
                originalFileName: task.originalFileName,
                errors: []
            });
            expect(response.body.completedAt).toBeDefined();
        });
    });

    describe('Worker Task Processing', () => {
        it('should process task with errors and result in FAILED status', async () => {
            const filePath = path.join(__dirname, 'fixtures', 'reservations.xlsx');
            const originalFileName = 'reservations_worker_test.xlsx';
            const fileSize = fs.statSync(filePath).size;
            const chunkSize = 1 * 1024 * 1024;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
            const uploadId = uuidv4();
            let chunkNumber = 0;
            let receivedTaskId: string | null = null;

            for await (const chunk of fileStream) {
                const isLastChunk = chunkNumber === totalChunks - 1;
                const response = await request(app.getHttpServer())
                    .post('/v1/task/upload')
                    .set('x-api-key', apiKey)
                    .attach('file', chunk, { filename: `chunk-${chunkNumber}.bin`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
                    .field('uploadId', uploadId)
                    .field('originalFileName', originalFileName)
                    .field('chunkNumber', chunkNumber)
                    .field('totalChunks', totalChunks);
                if (isLastChunk) {
                    receivedTaskId = response.body.taskId;
                }
                chunkNumber++;
            }
            expect(receivedTaskId).toBeDefined();
            expect(receivedTaskId).not.toBeNull();

            const eventProcessed = await waitForEventStatus(receivedTaskId!, EventStatus.PROCESSED);
            expect(eventProcessed).toBe(true);

            const taskCompleted = await waitForTaskStatus(receivedTaskId!, TaskStatus.FAILED);
            expect(taskCompleted).toBe(true);

            const task = await taskModel.findOne({ taskId: receivedTaskId }).lean();
            console.log('Task status after processing:', task?.status);

            expect(task).toBeDefined();
            expect(task?.status).toBe(TaskStatus.FAILED);
            expect(task?.errors).toBeDefined();
            expect(task?.errors.length).toBeGreaterThan(0);
            expect(task?.completedAt).toBeDefined();

            const event = await eventModel.findOne({ 'event.payload.taskId': receivedTaskId }).lean();
            expect(event?.status).toBe(EventStatus.PROCESSED);
            expect(event?.processedAt).toBeDefined();
            expect(event?.error).toBeUndefined();
        });

        it('should process valid task and result in COMPLETED status', async () => {
            const filePath = path.join(__dirname, 'fixtures', 'reservations-good.xlsx');
            const originalFileName = 'reservations_good_worker_test.xlsx';
            const fileSize = fs.statSync(filePath).size;
            const chunkSize = 1 * 1024 * 1024;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
            const uploadId = uuidv4();
            let chunkNumber = 0;
            let receivedTaskId: string | null = null;

            for await (const chunk of fileStream) {
                const isLastChunk = chunkNumber === totalChunks - 1;
                const response = await request(app.getHttpServer())
                    .post('/v1/task/upload')
                    .set('x-api-key', apiKey)
                    .attach('file', chunk, { filename: `chunk-${chunkNumber}.bin`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
                    .field('uploadId', uploadId)
                    .field('originalFileName', originalFileName)
                    .field('chunkNumber', chunkNumber)
                    .field('totalChunks', totalChunks);
                if (isLastChunk) {
                    receivedTaskId = response.body.taskId;
                }
                chunkNumber++;
            }
            expect(receivedTaskId).toBeDefined();
            expect(receivedTaskId).not.toBeNull();

            const eventProcessed = await waitForEventStatus(receivedTaskId!, EventStatus.PROCESSED, 30000);
            expect(eventProcessed).toBe(true);

            const taskCompleted = await waitForTaskStatus(receivedTaskId!, TaskStatus.COMPLETED, 30000);
            expect(taskCompleted).toBe(true);

            const task = await taskModel.findOne({ taskId: receivedTaskId }).lean();
            console.log('Task status after processing (good file):', task?.status);

            expect(task).toBeDefined();
            expect(task?.status).toBe(TaskStatus.COMPLETED);
            expect(task?.errors).toBeDefined();
            expect(task?.errors).toHaveLength(0);
            expect(task?.completedAt).toBeDefined();

            const event = await eventModel.findOne({ 'event.payload.taskId': receivedTaskId }).lean();
            expect(event?.status).toBe(EventStatus.PROCESSED);
            expect(event?.processedAt).toBeDefined();
            expect(event?.error).toBeUndefined();
        });
    });

    describe('/v1/task/report/:taskId (GET)', () => {
        let failedTaskId: string;
        let failedTaskOriginalName: string;
        let completedTaskId: string;

        beforeAll(async () => {
            const filePathErrors = path.join(__dirname, 'fixtures', 'reservations.xlsx');
            failedTaskOriginalName = 'reservations_report_test.xlsx';
            const fileSizeErrors = fs.statSync(filePathErrors).size;
            const chunkSizeErrors = 1 * 1024 * 1024;
            const totalChunksErrors = Math.ceil(fileSizeErrors / chunkSizeErrors);
            const fileStreamErrors = fs.createReadStream(filePathErrors, { highWaterMark: chunkSizeErrors });
            const uploadIdErrors = uuidv4();
            let chunkNumberErrors = 0;

            for await (const chunk of fileStreamErrors) {
                const isLastChunk = chunkNumberErrors === totalChunksErrors - 1;
                const response = await request(app.getHttpServer())
                    .post('/v1/task/upload')
                    .set('x-api-key', apiKey)
                    .attach('file', chunk, { filename: `chunk-${chunkNumberErrors}.bin`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
                    .field('uploadId', uploadIdErrors)
                    .field('originalFileName', failedTaskOriginalName)
                    .field('chunkNumber', chunkNumberErrors)
                    .field('totalChunks', totalChunksErrors);
                if (isLastChunk) {
                    failedTaskId = response.body.taskId;
                }
                chunkNumberErrors++;
            }
            expect(failedTaskId).toBeDefined();

            const eventProcessed = await waitForEventStatus(failedTaskId!, EventStatus.PROCESSED, 30000);
            expect(eventProcessed).toBe(true);
            const taskFailed = await waitForTaskStatus(failedTaskId!, TaskStatus.FAILED, 30000);
            expect(taskFailed).toBe(true);

            const completedTask = await createTestTask(TaskStatus.COMPLETED);
            completedTaskId = completedTask.taskId;
        });

        it('should return 401 for invalid API key', async () => {
            await request(app.getHttpServer())
                .get(`/v1/task/report/${failedTaskId}`)
                .set('x-api-key', 'invalid-key')
                .expect(401);
        });

        it('should return 404 for non-existent taskId', async () => {
            const nonExistentTaskId = uuidv4();
            await request(app.getHttpServer())
                .get(`/v1/task/report/${nonExistentTaskId}`)
                .set('x-api-key', apiKey)
                .expect(404);
        });

        it('should return 404 for a task that is not FAILED', async () => {
            await request(app.getHttpServer())
                .get(`/v1/task/report/${completedTaskId}`)
                .set('x-api-key', apiKey)
                .expect(404)
                .expect(res => {
                    expect(res.body.message).toContain(`status FAILED`);
                    expect(res.body.message).toContain(TaskStatus.COMPLETED);
                });
        });

        it('should return CSV report for a FAILED task', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/task/report/${failedTaskId}`)
                .set('x-api-key', apiKey)
                .expect(200);

            expect(response.headers['content-type']).toEqual('text/csv');
            expect(response.headers['content-disposition']).toContain(`attachment; filename="error_report_${failedTaskOriginalName}.csv"`);

            expect(response.text).toBeDefined();
            expect(response.text.length).toBeGreaterThan(0);
            expect(response.text).toContain('"Row","Error"\n');
            expect(response.text).toContain('Missing required field');
        });
    });
}); 