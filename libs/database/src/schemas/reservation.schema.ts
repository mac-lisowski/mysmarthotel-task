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

    @Prop({ required: true, enum: ReservationStatus, default: ReservationStatus.PENDING, type: String })
    status: ReservationStatus;

    @Prop({
        required: true,
        type: Date,
        transform: (date: Date) => date.toISOString().split('T')[0], // store only YYYY-MM-DD
    })
    checkInDate: Date;

    @Prop({
        required: true,
        type: Date,
        transform: (date: Date) => date.toISOString().split('T')[0], // store only YYYY-MM-DD
    })
    checkOutDate: Date;

    createdAt: Date;
    updatedAt: Date;
}

// Index for date range queries
const ReservationSchema = SchemaFactory.createForClass(Reservation);
ReservationSchema.index({ checkInDate: 1, checkOutDate: 1 });

export { ReservationSchema }; 