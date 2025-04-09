import { BaseEvent } from './base-event';

export interface TaskCreatedEventPayload {
    taskId: string;
    filePath: string;
    originalFileName: string;
}

export class TaskCreatedEvent extends BaseEvent<TaskCreatedEventPayload> {
    public readonly eventName = 'task.created.event';

    constructor(public readonly payload: TaskCreatedEventPayload) {
        super(payload);
    }
} 