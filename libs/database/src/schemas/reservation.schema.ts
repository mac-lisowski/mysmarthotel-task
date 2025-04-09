import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ReservationStatus } from '../reservation-status.enum';

export type ReservationDocument = Reservation & Document;

@Schema({ timestamps: true })
export class Reservation {
    @Prop({ required: true, index: true })
    reservationId: string;

    @Prop({ required: false })
    guestName: string;

    @Prop({ required: true, enum: ReservationStatus, default: ReservationStatus.PENDING })
    status: ReservationStatus;

    createdAt: Date;
    updatedAt: Date;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation); 