import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { FileService } from '@files';
import { CommandBus } from '@nestjs/cqrs';
import { UploadSession } from '../interfaces/upload-session.interface';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { CreateTaskCommand } from '../commands/create-task.command';

@Injectable()
export class TaskService {
    private readonly logger = new Logger(TaskService.name);
    private readonly UPLOAD_SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds

    constructor(
        @InjectRedis() private readonly redis: Redis,
        private readonly fileService: FileService,
        private readonly commandBus: CommandBus,
    ) { }

    /**
     * Handles an incoming file chunk, managing the multipart upload process.
     * @returns For intermediate chunks: { status: 'chunk_received' }
     *          For final chunk: { taskId: string }
     */
    async handleFileChunk(
        chunk: Express.Multer.File,
        chunkNumber: number,
        totalChunks: number,
        uploadId: string,
        originalFileName: string,
    ): Promise<{ status: string } | { taskId: string }> {
        try {
            if (chunkNumber >= totalChunks) {
                throw new BadRequestException('Chunk number exceeds total chunks');
            }

            const sessionKey = `upload:${uploadId}`;
            let session: UploadSession;

            if (chunkNumber === 0) {
                const bucketFilePath = `uploads/${uuidv4()}/${originalFileName}`;
                const s3UploadId = await this.fileService.createMultipartUpload(bucketFilePath, chunk.mimetype);

                session = {
                    s3UploadId,
                    bucketFilePath,
                    totalChunks,
                    originalFileName,
                    mimeType: chunk.mimetype,
                    uploadedParts: [],
                };

                await this.redis
                    .multi()
                    .set(sessionKey, JSON.stringify(session))
                    .expire(sessionKey, this.UPLOAD_SESSION_TTL)
                    .exec();
            } else {
                const sessionData = await this.redis.get(sessionKey);
                if (!sessionData) {
                    throw new BadRequestException('Upload session not found or expired');
                }
                session = JSON.parse(sessionData);
            }

            const partNumber = chunkNumber + 1;
            const etag = await this.fileService.uploadPart(
                session.bucketFilePath,
                session.s3UploadId,
                partNumber,
                chunk.buffer,
            );

            session.uploadedParts.push({
                PartNumber: partNumber,
                ETag: etag,
            });

            await this.redis.set(sessionKey, JSON.stringify(session));

            if (chunkNumber === totalChunks - 1) {
                return this.completeUpload(session);
            }

            return { status: 'chunk_received' };
        } catch (error) {
            this.logger.error(`Error handling file chunk: ${error.message}`, error.stack);
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Failed to process file chunk');
        }
    }

    /**
     * Completes the multipart upload and creates a task record.
     */
    private async completeUpload(session: UploadSession): Promise<{ taskId: string }> {
        try {
            const sortedParts = session.uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

            await this.fileService.completeMultipartUpload(
                session.bucketFilePath,
                session.s3UploadId,
                sortedParts,
            );

            const createTaskCommand = new CreateTaskCommand({
                s3ObjectKey: session.bucketFilePath,
                originalFileName: session.originalFileName,
            });

            const taskId = await this.commandBus.execute(createTaskCommand);
            return { taskId };
        } catch (error) {
            this.logger.error(`Error completing upload: ${error.message}`, error.stack);
            throw new InternalServerErrorException('Failed to complete upload');
        }
    }
} 