import { Module } from '@nestjs/common';
import { TasksModule } from './modules/tasks/tasks.module';
import apiConfig from './api.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CqrsModule } from '@nestjs/cqrs';
import { EventsModule } from '@events/events';
import { DatabaseModule } from '@database';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [apiConfig],
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
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        url: configService.getOrThrow('redis.url'),
        type: 'single',
      }),
      inject: [ConfigService],
    }),
    CqrsModule.forRoot(),
    DatabaseModule,
    EventsModule,
    TasksModule,
  ],
  controllers: [],
  providers: [],
})
export class ApiModule { }
