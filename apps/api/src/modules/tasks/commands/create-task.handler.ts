import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { Task, TaskDocument } from '@database/schemas/task.schema';
import { Event, EventDocument } from '@database/schemas/event.schema';
import { TaskStatus } from '@database/task-status.enum';
import { EventStatus } from '@database/event-status.enum';
import { CreateTaskCommand } from '../create-task.command';
import { Connection } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { v4 as uuidv4 } from 'uuid';
import { TaskCreatedEvent } from '@events/events';

@CommandHandler(CreateTaskCommand)
export class CreateTaskHandler implements ICommandHandler<CreateTaskCommand> {
    private readonly logger = new Logger(CreateTaskHandler.name);

    constructor(
        @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
        @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
        @InjectConnection() private readonly connection: Connection,
    ) { }

    async execute(command: CreateTaskCommand): Promise<string> {
        const session = await this.connection.startSession();

        try {
            session.startTransaction();

            const taskId = uuidv4();
            const task = await this.taskModel.create([{
                taskId,
                filePath: command.payload.s3ObjectKey,
                originalFileName: command.payload.originalFileName,
                status: TaskStatus.PENDING,
                startedAt: new Date(),
            }], { session });

            const taskCreatedEvent = new TaskCreatedEvent({
                taskId,
                filePath: command.payload.s3ObjectKey,
                originalFileName: command.payload.originalFileName,
            });

            const event = await this.eventModel.create([{
                eventName: taskCreatedEvent.eventName,
                event: taskCreatedEvent,
                status: EventStatus.NEW,
            }], { session });

            await session.commitTransaction();
            this.logger.debug(`Created new task with ID: ${taskId} and associated event: ${event[0]._id}`);

            return taskId;
        } catch (error) {
            await session.abortTransaction();
            this.logger.error(`Failed to create task: ${error.message}`, error.stack);
            throw error;
        } finally {
            await session.endSession();
        }
    }
} 