import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
     * Uploads a file to the S3 bucket.
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