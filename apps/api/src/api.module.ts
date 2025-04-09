import { Logger, Module } from '@nestjs/common';
import { TasksModule } from './modules/tasks/tasks.module';
import apiConfig from './api.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { CqrsModule } from '@nestjs/cqrs';

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
    CqrsModule.forRoot(),
    TasksModule,
  ],
  controllers: [],
  providers: [],
})
export class ApiModule { }
