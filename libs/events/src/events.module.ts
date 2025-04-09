import { Module, Global } from '@nestjs/common';
import { EventsService } from './services/events.service';
import { DatabaseModule } from '@database';

@Global()
@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule { }
