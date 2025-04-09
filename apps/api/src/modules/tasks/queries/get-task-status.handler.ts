import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { Task, TaskDocument } from 'libs/database/src/schemas/task.schema';
import { GetTaskStatusQuery } from './get-task-status.query';
import { TaskStatusResponseDto } from '../dto/task-status-response.dto';

@QueryHandler(GetTaskStatusQuery)
export class GetTaskStatusHandler implements IQueryHandler<GetTaskStatusQuery> {
    constructor(
        @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    ) { }

    async execute(query: GetTaskStatusQuery): Promise<TaskStatusResponseDto> {
        const { taskId } = query;

        const task = await this.taskModel.findOne({ taskId }).lean().exec();

        if (!task) {
            throw new NotFoundException(`Task with ID "${taskId}" not found`);
        }

        // Map the Task entity to the DTO
        return {
            taskId: task.taskId,
            status: task.status,
            errors: task.errors,
            originalFileName: task.originalFileName,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
        };
    }
} 