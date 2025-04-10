import { InjectModel } from '@nestjs/mongoose';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Model } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { Task, TaskDocument, TaskStatus } from '@database';
import { GetFailedTaskErrorReportQuery, GetFailedTaskErrorReportResult } from './get-failed-task-error-report.query';

@QueryHandler(GetFailedTaskErrorReportQuery)
export class GetFailedTaskErrorReportHandler implements IQueryHandler<GetFailedTaskErrorReportQuery, GetFailedTaskErrorReportResult> {

    constructor(
        @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    ) { }

    async execute(query: GetFailedTaskErrorReportQuery): Promise<GetFailedTaskErrorReportResult> {
        const { taskId } = query;

        const task = await this.taskModel.findOne({ taskId }).lean().exec();

        if (!task) {
            throw new NotFoundException(`Task with ID '${taskId}' not found.`);
        }

        if (task.status !== TaskStatus.FAILED) {
            throw new NotFoundException(`Error report is only available for tasks with status FAILED. Task '${taskId}' has status '${task.status}'.`);
        }

        return {
            errors: task.errors || [],
            originalFileName: task.originalFileName,
        };
    }
} 