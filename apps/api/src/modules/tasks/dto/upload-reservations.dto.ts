import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, Max, IsUUID, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadReservationsDto {
    @ApiProperty({ type: 'string', format: 'binary', description: 'XLSX file chunk' })
    file: Express.Multer.File;

    @ApiProperty({ type: 'number', description: 'Current chunk number (0-based)' })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    chunkNumber: number;

    @ApiProperty({ type: 'number', description: 'Total number of chunks' })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    totalChunks: number;

    @ApiProperty({ type: 'string', description: 'Original file name' })
    @IsString()
    @Matches(/^[\w,\s-]+\.xlsx$/, {
        message: 'originalFileName must be a valid .xlsx filename'
    })
    originalFileName: string;

    @ApiProperty({ type: 'string', description: 'Unique identifier for the upload session' })
    @IsUUID(4)
    uploadId: string;
} 