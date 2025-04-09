export interface UploadSession {
    s3UploadId: string;
    bucketFilePath: string;
    totalChunks: number;
    originalFileName: string;
    mimeType: string;
    uploadedParts: {
        PartNumber: number;
        ETag: string;
    }[];
} 