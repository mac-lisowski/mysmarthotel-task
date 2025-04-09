import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import workerConfig from './worker.config';
import { MongooseModule } from '@nestjs/mongoose';
import { CqrsModule } from '@nestjs/cqrs';
import { ScheduleModule } from '@nestjs/schedule';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { EventsModule as SharedEventsModule, Exchange } from '@events/events';
import { EventsModule as WorkerOutboxEventsModule } from './modules/events/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [workerConfig],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          uri: configService.getOrThrow('mongodb.url'),
        };
      },
      inject: [ConfigService],
    }),
    RabbitMQModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow('rabbitmq.url'),
        connectionInitOptions: { wait: true, timeout: 30000 },
        exchanges: [
          {
            createExchangeIfNotExists: true,
            name: Exchange.EVENTS,
            type: 'fanout',
            options: { durable: true },
          },
          {
            createExchangeIfNotExists: true,
            name: Exchange.WORKER,
            type: 'topic',
            options: { durable: true },
          },
          {
            createExchangeIfNotExists: true,
            name: Exchange.DLQ,
            type: 'topic',
            options: { durable: true },
          },
        ],
        exchangeBindings: [
          {
            source: Exchange.EVENTS,
            destination: Exchange.WORKER,
            pattern: '#.event',
          },
          {
            source: Exchange.DLQ,
            destination: Exchange.WORKER,
            pattern: 'dlq-publish',
          },
        ],
        queues: [
          {
            name: 'q.worker.task',
            exchange: Exchange.WORKER,
            routingKey: ['task.event', 'dlq-publish'],
            options: {
              durable: true,
              deadLetterExchange: Exchange.DLQ,
              deadLetterRoutingKey: 'dlq-delay',
            },
          },
          {
            exchange: Exchange.DLQ,
            routingKey: 'dlq-delay',
            name: 'q.dlq.worker-task',
            options: {
              durable: true,
              messageTtl: 60000 * 2,
              deadLetterExchange: Exchange.DLQ,
              deadLetterRoutingKey: 'dlq-publish',
            },
          },
        ],
      }),
      inject: [ConfigService],
      imports: [ConfigModule],
    }),
    ScheduleModule.forRoot(),
    CqrsModule.forRoot(),
    SharedEventsModule,
    WorkerOutboxEventsModule,
  ],
  controllers: [],
  providers: [],
})
export class WorkerModule { }
