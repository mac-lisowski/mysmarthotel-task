import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    ListObjectsV2Command,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    CompletedPart,
    AbortMultipartUploadCommand,
    GetObjectCommand,
    GetObjectCommandOutput,
    S3ServiceException
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

interface RetryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 5000   // 5 seconds
};

@Injectable()
export class FileService {
    private readonly logger = new Logger(FileService.name);
    private readonly s3Client: S3Client;
    private readonly bucketName: string;

    constructor(private readonly configService: ConfigService) {
        this.s3Client = new S3Client({
            region: this.configService.get('s3.region'),
            endpoint: this.configService.get('s3.endpoint'),
            credentials: {
                accessKeyId: this.configService.getOrThrow('s3.accessKeyId'),
                secretAccessKey: this.configService.getOrThrow('s3.secretAccessKey'),
            },
            forcePathStyle: true,
        });
        this.bucketName = this.configService.getOrThrow('s3.bucketName');
    }

    /**
     * Determines if an S3 error is retryable.
     * @param error - The error to check
     * @returns boolean indicating if the error is retryable
     */
    private isRetryableError(error: any): boolean {
        if (!(error instanceof S3ServiceException)) {
            return false;
        }

        const retryableErrors = [
            'RequestTimeout',
            'RequestTimeoutException',
            'PriorRequestNotComplete',
            'ConnectionError',
            'NetworkingError',
            'ThrottlingException',
            'TooManyRequestsException',
            'InternalError',
            'ServiceUnavailable',
            'SlowDown',
        ];

        return retryableErrors.includes(error.name) ||
            (error.$metadata?.httpStatusCode ?? 0) >= 500;
    }

    /**
     * Implements exponential backoff for retries.
     * @param retryCount - Current retry attempt number
     * @param config - Retry configuration
     * @returns Delay in milliseconds
     */
    private getBackoffDelay(retryCount: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
        const delay = Math.min(
            config.maxDelay,
            config.baseDelay * Math.pow(2, retryCount)
        );
        return delay * (0.75 + Math.random() * 0.5);
    }

    /**
     * Executes an S3 operation with retries.
     * @param operation - The S3 operation to execute
     * @param config - Retry configuration
     * @returns The result of the operation
     * @throws The last error encountered if all retries fail
     */
    private async executeWithRetry<T>(
        operation: () => Promise<T>,
        config: RetryConfig = DEFAULT_RETRY_CONFIG
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (!this.isRetryableError(error) || attempt === config.maxRetries) {
                    throw error;
                }

                const delay = this.getBackoffDelay(attempt, config);
                this.logger.debug(`Retrying operation after ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // This should never happen due to the throw in the loop, but TypeScript needs it
        throw lastError;
    }

    /**
     * Deletes a file from the S3 bucket.
     * @param bucketFilePath - The path to the file in the bucket.
     * @returns A boolean indicating whether the deletion was successful.
     * @throws Error if deletion fails
     */
    async deleteFile(bucketFilePath: string): Promise<boolean> {
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));

            if (response.$metadata.httpStatusCode === HttpStatus.NO_CONTENT) {
                this.logger.debug(`Successfully deleted file ${bucketFilePath}`);
                return true;
            }

            this.logger.warn(`Unexpected status code ${response.$metadata.httpStatusCode} when deleting file ${bucketFilePath}`);
            return false;
        } catch (err) {
            this.logger.error(`Failed to delete file ${bucketFilePath}`, err);
            throw new Error(`Unable to delete file from S3: ${err.message}`);
        }
    }

    /**
     * Uploads a file using a single PutObject command (suitable for smaller files).
     * @param bucketFilePath - The path to the file in the bucket.
     * @param fileBody - The body of the file.
     * @param mimeType - The MIME type of the file.
     * @returns The key of the uploaded file, or null if the upload failed.
     */
    async uploadFile(
        bucketFilePath: string,
        fileBody: Buffer,
        mimeType: string,
    ): Promise<string | null> {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
            Body: fileBody,
            ContentType: mimeType,
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));

            if (response.$metadata.httpStatusCode === HttpStatus.OK) {
                return bucketFilePath;
            }

            return null;
        } catch (err) {
            this.logger.error(`Unable to upload file to S3`, err);
            throw new Error('Unable to upload file to S3');
        }
    }

    /**
     * Initiates a multipart upload.
     * @param bucketFilePath - The desired key for the object in S3.
     * @param mimeType - The MIME type of the file.
     * @returns The UploadId for the multipart upload.
     * @throws Error if initiation fails.
     */
    async createMultipartUpload(bucketFilePath: string, mimeType: string): Promise<string> {
        const command = new CreateMultipartUploadCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
            ContentType: mimeType,
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));
            if (!response.UploadId) {
                throw new Error('S3 did not return an UploadId');
            }
            this.logger.debug(`Initiated multipart upload for ${bucketFilePath} with UploadId: ${response.UploadId}`);
            return response.UploadId;
        } catch (err) {
            this.logger.error(`Failed to initiate multipart upload for ${bucketFilePath}`, err);
            throw new Error(`Unable to initiate multipart upload: ${err.message}`);
        }
    }

    /**
     * Uploads a part (chunk) of a multipart upload.
     * @param bucketFilePath - The key of the object in S3.
     * @param s3UploadId - The UploadId received from createMultipartUpload.
     * @param partNumber - The sequential number (1-based) of the part.
     * @param chunkBuffer - The buffer containing the data for this part.
     * @returns The ETag of the uploaded part.
     * @throws Error if part upload fails.
     */
    async uploadPart(bucketFilePath: string, s3UploadId: string, partNumber: number, chunkBuffer: Buffer): Promise<string> {
        const command = new UploadPartCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
            UploadId: s3UploadId,
            PartNumber: partNumber,
            Body: chunkBuffer,
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));
            if (!response.ETag) {
                throw new Error('S3 did not return an ETag for the uploaded part');
            }
            this.logger.debug(`Uploaded part ${partNumber} for ${bucketFilePath} (UploadId: ${s3UploadId})`);
            return response.ETag;
        } catch (err) {
            this.logger.error(`Failed to upload part ${partNumber} for ${bucketFilePath} (UploadId: ${s3UploadId})`, err);
            throw new Error(`Unable to upload part ${partNumber}: ${err.message}`);
        }
    }

    /**
     * Completes a multipart upload.
     * @param bucketFilePath - The key of the object in S3.
     * @param s3UploadId - The UploadId of the multipart upload.
     * @param parts - An array of objects, each containing PartNumber and ETag.
     * @returns The final ETag of the completed object or location.
     * @throws Error if completion fails.
     */
    async completeMultipartUpload(bucketFilePath: string, s3UploadId: string, parts: CompletedPart[]): Promise<string | undefined> {
        const sortedParts = [...parts].sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));

        const command = new CompleteMultipartUploadCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
            UploadId: s3UploadId,
            MultipartUpload: {
                Parts: sortedParts,
            },
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));
            this.logger.debug(`Completed multipart upload for ${bucketFilePath} (UploadId: ${s3UploadId})`);
            return response.ETag ?? response.Location;
        } catch (err) {
            this.logger.error(`Failed to complete multipart upload for ${bucketFilePath} (UploadId: ${s3UploadId})`, err);
            throw new Error(`Unable to complete multipart upload: ${err.message}`);
        }
    }

    /**
     * Aborts a multipart upload.
     * @param bucketFilePath - The key of the object in S3.
     * @param s3UploadId - The UploadId of the multipart upload to abort.
     * @throws Error if abort operation fails.
     */
    async abortMultipartUpload(bucketFilePath: string, s3UploadId: string): Promise<void> {
        const command = new AbortMultipartUploadCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
            UploadId: s3UploadId,
        });

        try {
            await this.executeWithRetry(() => this.s3Client.send(command));
            this.logger.debug(`Aborted multipart upload for ${bucketFilePath} (UploadId: ${s3UploadId})`);
        } catch (err) {
            this.logger.error(`Failed to abort multipart upload for ${bucketFilePath} (UploadId: ${s3UploadId})`, err);
            // Log error but don't necessarily throw, as the upload might be inconsistent anyway
            // Rethrow if crucial for subsequent logic
            throw new Error(`Unable to abort multipart upload: ${err.message}`);
        }
    }

    /**
     * Converts a stream to a buffer.
     * @param stream - The stream to convert.
     * @returns The buffer of the stream.
     */
    async streamToBuffer(stream: Readable): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('error', (err: Error) => reject(err));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }

    /**
     * Checks if a file exists in the S3 bucket.
     * @param bucketFilePath - The path to the file in the bucket.
     * @returns A boolean indicating whether the file exists.
     * @throws Error if check fails
     */
    async fileExists(bucketFilePath: string): Promise<boolean> {
        const command = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));
            return response.$metadata.httpStatusCode === HttpStatus.OK;
        } catch (err: any) {
            if (err.name === 'NotFound') {
                return false;
            }
            this.logger.error(`Failed to check file existence ${bucketFilePath}`, err);
            throw new Error(`Unable to check file existence in S3: ${err.message}`);
        }
    }

    /**
     * Downloads a file from S3 and returns it as a readable stream.
     * @param bucketFilePath - The path to the file in the bucket.
     * @returns A readable stream of the file content and metadata.
     * @throws Error if download fails or file doesn't exist.
     */
    async downloadFile(bucketFilePath: string): Promise<{ stream: Readable; metadata: GetObjectCommandOutput }> {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: bucketFilePath,
        });

        try {
            const response = await this.executeWithRetry(() => this.s3Client.send(command));

            if (!response.Body) {
                throw new Error('S3 returned empty response body');
            }

            if (!(response.Body instanceof Readable)) {
                throw new Error('S3 response body is not a readable stream');
            }

            this.logger.debug(`Successfully initiated download for file ${bucketFilePath}`);

            return {
                stream: response.Body as Readable,
                metadata: response
            };
        } catch (err) {
            this.logger.error(`Failed to download file ${bucketFilePath}`, err);
            if (err.name === 'NoSuchKey') {
                throw new Error(`File ${bucketFilePath} not found in S3`);
            }
            throw new Error(`Unable to download file from S3: ${err.message}`);
        }
    }

    /**
     * Process a file in chunks using a stream.
     * @param stream - The readable stream to process
     * @param chunkSize - Size of each chunk in bytes (default: 64KB)
     * @param processor - Async function to process each chunk
     * @returns Promise that resolves when processing is complete
     */
    async processFileInChunks(
        stream: Readable,
        processor: (chunk: Buffer) => Promise<void>,
        chunkSize: number = 64 * 1024 // 64KB default chunk size
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(0);

            stream.on('data', async (chunk: Buffer) => {
                try {
                    buffer = Buffer.concat([buffer, chunk]);

                    while (buffer.length >= chunkSize) {
                        const chunkToProcess = buffer.slice(0, chunkSize);
                        buffer = buffer.slice(chunkSize);

                        stream.pause();
                        await processor(chunkToProcess);
                        stream.resume();
                    }
                } catch (error) {
                    reject(error);
                }
            });

            stream.on('end', async () => {
                try {
                    if (buffer.length > 0) {
                        await processor(buffer);
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            stream.on('error', (error) => {
                reject(error);
            });
        });
    }
}