import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import * as os from 'os';
import { Event, EventDocument } from '@database/schemas';
import { EventStatus } from '@database';
import { Exchange } from '@events/events';

const BATCH_SIZE = 500;
const STALE_EVENT_THRESHOLD_SECONDS = 60;

@Injectable()
export class EventsService {
    private readonly logger = new Logger(EventsService.name);
    private readonly workerId: string;

    constructor(
        private readonly amqpConnection: AmqpConnection,
        @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
        @InjectConnection() private readonly connection: Connection,
    ) {
        this.workerId = `${os.hostname()}-${process.pid}`;
        this.logger.log(`Initialized EventsService with worker ID: ${this.workerId}`);
    }

    @Cron(CronExpression.EVERY_SECOND)
    async publishNewEvents() {
        this.logger.debug(`[${this.workerId}] Starting event processing cycle`);
        const now = new Date();

        try {
            const claimResult = await this.eventModel
                .updateMany(
                    { status: EventStatus.NEW },
                    {
                        $set: {
                            status: EventStatus.PROCESSING,
                            workerId: this.workerId,
                            processingAt: now,
                        },
                    },
                    { sort: { createdAt: 1 }, limit: BATCH_SIZE },
                )
                .exec();

            const claimedCount = claimResult.modifiedCount;
            if (claimedCount === 0) {
                this.logger.debug(`[${this.workerId}] No new events claimed.`);
                return;
            }
            this.logger.log(
                `[${this.workerId}] Claimed ${claimedCount} events for processing.`,
            );

            const eventsToProcess = await this.eventModel
                .find({
                    status: EventStatus.PROCESSING,
                    workerId: this.workerId,
                })
                .where('processingAt')
                .lte(now.getTime())
                .exec();

            if (eventsToProcess.length === 0) {
                this.logger.warn(
                    `[${this.workerId}] Claimed ${claimedCount} but found 0 events matching workerId for processing. Possible race condition or delay.`,
                );
                return;
            }
            this.logger.debug(
                `[${this.workerId}] Attempting to process ${eventsToProcess.length} claimed events.`,
            );

            for (const event of eventsToProcess) {
                let session: ClientSession | undefined;
                const eventIdString = (event._id as Types.ObjectId).toString();

                try {
                    session = await this.connection.startSession();
                    await session.withTransaction(async (currentSession) => {
                        const messagePayload = {
                            eventId: eventIdString,
                            ...(event as any).payload,
                        };

                        await this.amqpConnection.publish(
                            Exchange.EVENTS,
                            event.eventName,
                            messagePayload,
                            { persistent: true },
                        );

                        const updateResult = await this.eventModel.updateOne(
                            {
                                _id: event._id,
                                status: EventStatus.PROCESSING,
                                workerId: this.workerId,
                            },
                            {
                                $set: {
                                    status: EventStatus.PUBLISHED,
                                    processedAt: new Date(),
                                },
                                $unset: {
                                    processingAt: '',
                                    workerId: '',
                                },
                            },
                            { session: currentSession },
                        );

                        if (updateResult.modifiedCount === 0) {
                            throw new Error(
                                `Event ${eventIdString} status update failed (modifiedCount: 0). Concurrent modification or recovery likely.`,
                            );
                        }
                        this.logger.debug(
                            `[${this.workerId}] Event ${eventIdString} (${event.eventName}) published and status updated to PUBLISHED.`,
                        );
                    });
                } catch (error: any) {
                    this.logger.error(
                        `[${this.workerId}] Failed to process event ${eventIdString}: ${error.message}`,
                        error.stack,
                    );
                } finally {
                    if (session) {
                        await session.endSession();
                    }
                }
            }
            this.logger.debug(`[${this.workerId}] Finished processing cycle.`);
        } catch (error: any) {
            this.logger.error(
                `[${this.workerId}] Error in publishNewEvents cycle: ${error.message}`,
                error.stack,
            );
        }
    }

    @Cron('*/2 * * * *')
    async recoverStaleEvents() {
        const threshold = new Date();
        threshold.setSeconds(
            threshold.getSeconds() - STALE_EVENT_THRESHOLD_SECONDS,
        );
        this.logger.debug(
            `[${this.workerId}] Running stale event recovery (threshold: ${STALE_EVENT_THRESHOLD_SECONDS}s)`,
        );
        try {
            const result = await this.eventModel
                .updateMany(
                    {
                        status: EventStatus.PROCESSING,
                        processingAt: { $lt: threshold },
                    },
                    {
                        $set: { status: EventStatus.NEW },
                        $unset: { processingAt: '', workerId: '' },
                    },
                )
                .exec();

            if (result.modifiedCount > 0) {
                this.logger.warn(
                    `[${this.workerId}] Reset ${result.modifiedCount} stale events back to NEW status.`,
                );
            } else {
                this.logger.debug(`[${this.workerId}] No stale events found.`);
            }
        } catch (error: any) {
            this.logger.error(
                `[${this.workerId}] Error during stale event recovery: ${error.message}`,
                error.stack,
            );
        }
    }
} 