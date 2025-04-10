import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Exchange, TaskCreatedEvent, TaskCreatedEventPayload } from '@events/events';

@Injectable()
export class TasksService {
    private readonly logger = new Logger(TasksService.name);

    @RabbitSubscribe({
        exchange: 'worker',
        routingKey: 'task.created.event',
        queue: 'q.worker.task',
        queueOptions: {
            durable: true,
            deadLetterExchange: Exchange.DLQ,
            deadLetterRoutingKey: 'dlq-delay',
        }
    })
    async handleTaskCreated(msg: TaskCreatedEvent & { eventId: string }): Promise<Nack | void> {
        this.logger.log('OK - Received TaskCreatedEvent');
        this.logger.debug('Event payload:', msg);

        console.log(`>>>>>>>>>>>>> msg: `, msg, msg.eventId)

        return;
    }
}