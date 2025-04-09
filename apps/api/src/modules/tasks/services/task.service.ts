import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class TaskService {
    private readonly tempDir: string;

    constructor(
        private readonly configService: ConfigService,
    ) {
        this.tempDir = path.join(os.tmpdir(), 'smarthotel-uploads');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async handleFileChunk(
        chunk: Express.Multer.File,
        chunkNumber: number,
        totalChunks: number,
        uploadId: string,
        originalFileName: string,
    ): Promise<{ completed: boolean }> {
        const chunkDir = path.join(this.tempDir, uploadId);

        if (!fs.existsSync(chunkDir)) {
            fs.mkdirSync(chunkDir, { recursive: true });
        }

        const chunkPath = path.join(chunkDir, `chunk-${chunkNumber}`);
        fs.writeFileSync(chunkPath, chunk.buffer);

        const uploadedChunks = fs.readdirSync(chunkDir).length;

        if (uploadedChunks === totalChunks) {
            return { completed: true };
        }

        return { completed: false };
    }

    private async cleanupChunks(uploadId: string): Promise<void> {
        const chunkDir = path.join(this.tempDir, uploadId);
        if (fs.existsSync(chunkDir)) {
            fs.rmSync(chunkDir, { recursive: true, force: true });
        }
    }
} 