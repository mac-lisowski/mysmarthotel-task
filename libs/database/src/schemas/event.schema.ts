import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { EventStatus } from '../event-status.enum';

export type EventDocument = Event & Document;

@Schema({ timestamps: true })
export class Event {
    @Prop({ required: true })
    eventName: string;

    @Prop({ required: true, type: Object })
    event: Record<string, any>;

    @Prop({ required: true, enum: EventStatus, default: EventStatus.NEW, type: String })
    status: EventStatus;

    @Prop({ required: false, type: Object })
    error: Record<string, any>;

    @Prop({ required: false, type: Date })
    publishedAt: Date;

    @Prop({ required: false, type: Date })
    processedAt: Date;

    @Prop({ required: false, type: Date, index: true })
    processingAt: Date | null;

    @Prop({ required: false, type: String })
    workerId: string | null;

    createdAt: Date;
    updatedAt: Date;
}

export const EventSchema = SchemaFactory.createForClass(Event); 