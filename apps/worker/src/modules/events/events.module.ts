import { Module } from '@nestjs/common';
import { EventsService } from './services/events.service';
import { ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

@Module({
    imports: [
        RabbitMQModule.forRootAsync({
            useFactory: (configService: ConfigService) => {
                return {
                    uri: configService.getOrThrow('rabbitmq.url'),
                    connectionInitOptions: { wait: true, timeout: 30000 },
                };
            },
            inject: [ConfigService],
        }),
    ],
    providers: [EventsService],
    exports: [],
})
export class EventsModule { } 