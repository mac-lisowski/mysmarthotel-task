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
    AbortMultipartUploadCommand
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

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
        });
        this.bucketName = this.configService.getOrThrow('s3.bucketName');
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
            const response = await this.s3Client.send(command);

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
            const response = await this.s3Client.send(command);

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
            const response = await this.s3Client.send(command);
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
            const response = await this.s3Client.send(command);
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
        // Ensure parts are sorted by PartNumber as required by S3
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
            const response = await this.s3Client.send(command);
            this.logger.debug(`Completed multipart upload for ${bucketFilePath} (UploadId: ${s3UploadId})`);
            // Location might be useful, ETag confirms integrity
            return response.ETag ?? response.Location;
        } catch (err) {
            this.logger.error(`Failed to complete multipart upload for ${bucketFilePath} (UploadId: ${s3UploadId})`, err);
            // Consider aborting upload here if completion fails critically?
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
            await this.s3Client.send(command);
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
            const response = await this.s3Client.send(command);
            return response.$metadata.httpStatusCode === HttpStatus.OK;
        } catch (err: any) {
            // AWS SDK throws NoSuchKey error when file doesn't exist
            if (err.name === 'NotFound') {
                return false;
            }
            this.logger.error(`Failed to check file existence ${bucketFilePath}`, err);
            throw new Error(`Unable to check file existence in S3: ${err.message}`);
        }
    }
}