import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Event, EventSchema } from './schemas/event.schema';
import { Task, TaskSchema } from './schemas/task.schema';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule { }
