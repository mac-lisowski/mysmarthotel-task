import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, IsUUID, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadReservationsBodyDto {
    @ApiProperty({ type: 'number', description: 'Current chunk number (0-based)', example: 0 })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    chunkNumber: number;

    @ApiProperty({ type: 'number', description: 'Total number of chunks', example: 5 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    totalChunks: number;

    @ApiProperty({ type: 'string', description: 'Original file name', example: 'reservations_final.xlsx' })
    @IsString()
    @Matches(/^[\w,\s-]+\.xlsx$/, {
        message: 'originalFileName must be a valid .xlsx filename'
    })
    originalFileName: string;

    @ApiProperty({ type: 'string', format: 'uuid', description: 'Unique identifier for the upload session', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    @IsUUID(4)
    uploadId: string;
} 