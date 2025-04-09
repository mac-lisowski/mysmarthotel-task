import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TaskStatus } from '../task-status.enum';

export type TaskDocument = Task & Document;

@Schema({ timestamps: true })
export class Task {
    @Prop({ required: true })
    taskId: string;

    @Prop({ required: true })
    fileId: string;

    @Prop({ required: true, enum: TaskStatus, default: TaskStatus.PENDING })
    status: TaskStatus;

    @Prop({ required: false, type: Object })
    error: Record<string, any>;

    @Prop({ required: false, type: Date })
    startedAt: Date;

    @Prop({ required: false, type: Date })
    completedAt: Date;

    createdAt: Date;
    updatedAt: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task); 