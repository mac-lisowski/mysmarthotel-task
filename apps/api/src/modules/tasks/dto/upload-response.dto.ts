import { ApiProperty } from '@nestjs/swagger';

export class ChunkReceivedResponseDto {
    @ApiProperty({ description: 'Status of the chunk upload', example: 'chunk_received' })
    status: string;
}

export class UploadCompletedResponseDto {
    @ApiProperty({ description: 'ID of the created task', example: '123e4567-e89b-12d3-a456-426614174000' })
    taskId: string;
} 