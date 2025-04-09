import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus } from 'libs/database/src/task-status.enum';

export class TaskStatusResponseDto {
    @ApiProperty({ description: "Unique identifier for the task", example: "upload_abc123" })
    taskId: string;

    @ApiProperty({ description: "Current status of the task", enum: TaskStatus, example: TaskStatus.IN_PROGRESS })
    status: TaskStatus;

    @ApiProperty({ description: "List of errors encountered during processing", type: [Object], required: false, example: [{ row: 10, error: "Invalid date format" }] })
    errors?: Record<string, any>[];

    @ApiProperty({ description: "Original name of the uploaded file", example: "reservations_2024_07.xlsx" })
    originalFileName: string;

    @ApiProperty({ description: "Timestamp when task processing started", type: Date, required: false, example: "2024-07-29T10:00:00.000Z" })
    startedAt?: Date;

    @ApiProperty({ description: "Timestamp when task processing completed", type: Date, required: false, example: "2024-07-29T10:05:00.000Z" })
    completedAt?: Date;

    @ApiProperty({ description: "Timestamp when the task record was created", example: "2024-07-29T09:59:00.000Z" })
    createdAt: Date;

    @ApiProperty({ description: "Timestamp when the task record was last updated", example: "2024-07-29T10:01:00.000Z" })
    updatedAt: Date;
} 