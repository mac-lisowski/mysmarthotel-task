import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { ApiModule } from '../src/api.module';
import { v4 as uuidv4 } from 'uuid';
import { Connection, Model } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Task, TaskDocument, TaskStatus } from '@database';
import { useContainer } from 'class-validator';

describe('TaskController (e2e)', () => {
    let app: INestApplication;
    let mongooseConnection: Connection;
    let taskModel: Model<TaskDocument>;
    let apiKey: string;

    // Setup application context once for all tests in this suite
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
        // Get the Mongoose model for Task
        taskModel = moduleFixture.get<Model<TaskDocument>>(getModelToken(Task.name));

        // Set the global prefix for the test application instance
        app.setGlobalPrefix('v1');

        // Re-enable ValidationPipe exactly as in main.ts
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

    // Cleanup after all tests in this suite are done
    afterAll(async () => {
        if (mongooseConnection) {
            // Optional: Clean up test data if needed
            // await taskModel.deleteMany({}).exec(); 
            await mongooseConnection.close();
        }
        if (app) {
            await app.close();
        }
    });

    it('/v1/task/upload (POST) - should upload file in chunks and create task entry', async () => {
        const filePath = path.join(__dirname, 'fixtures', 'reservations.xlsx');
        const originalFileName = 'reservations.xlsx';
        const fileSize = fs.statSync(filePath).size;
        const chunkSize = 1 * 1024 * 1024; // 1MB chunks
        const totalChunks = Math.ceil(fileSize / chunkSize);
        const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
        const uploadId = uuidv4();
        let chunkNumber = 0;
        let receivedTaskId: string | null = null;

        console.log(`Uploading ${originalFileName} (${fileSize} bytes) in ${totalChunks} chunks...`);

        for await (const chunk of fileStream) {
            const isLastChunk = chunkNumber === totalChunks - 1;
            console.log(`Sending chunk ${chunkNumber + 1}/${totalChunks}`);

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
                console.log(`Final chunk sent. Received Task ID: ${receivedTaskId}`);
            } else {
                expect(response.body).toEqual({ status: 'chunk_received' });
            }
            chunkNumber++;
        }

        // --- Verification --- 
        expect(chunkNumber).toEqual(totalChunks); // Ensure all chunks were processed
        expect(receivedTaskId).not.toBeNull(); // Ensure we got a task ID

        console.log(`Verifying task ${receivedTaskId} in database...`);

        // Find the task created in the database
        const foundTask = await taskModel.findOne({ taskId: receivedTaskId }).lean().exec();

        expect(foundTask).toBeDefined(); // Check if task exists
        expect(foundTask).not.toBeNull();

        if (foundTask) { // Type guard
            console.log(`Found task: ${JSON.stringify(foundTask)}`);
            expect(foundTask.taskId).toEqual(receivedTaskId);
            expect(foundTask.originalFileName).toEqual(originalFileName);
            expect(foundTask.status).toEqual(TaskStatus.PENDING); // Assuming it starts as PENDING
            expect(foundTask.filePath).toBeDefined();
            expect(typeof foundTask.filePath).toBe('string');
            expect(foundTask.filePath).toContain(originalFileName); // File path should contain original name
            // Add more specific assertions about filePath if needed (e.g., format)
            expect(foundTask.createdAt).toBeInstanceOf(Date);
            expect(foundTask.updatedAt).toBeInstanceOf(Date);
        }
    });

    // TODO: Add more tests for error cases:
    // - Invalid API key (401)
    // - Invalid file type (400)
    // - Missing fields (400)
    // - Chunk number out of bounds (400)
    // - Invalid uploadId (400)


    // TODO: Add tests for the getTaskStatus endpoint
    // - Invalid taskId (404)
    // - Valid taskId, but task not found (404)
    // - Valid taskId (200)
}); 