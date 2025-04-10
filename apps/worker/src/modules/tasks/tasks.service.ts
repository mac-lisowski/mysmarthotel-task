import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Exchange, TaskCreatedEvent } from '@events/events';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, ClientSession } from 'mongoose';
import { Task, TaskDocument, Event, EventDocument, TaskStatus, EventStatus, ReservationStatus, Reservation, ReservationDocument } from '@database';
import { FileService } from '@files';
import * as XLSX from 'xlsx';
import * as os from 'os';

interface ReservationRow {
    reservation_id: string;
    guest_name: string;
    check_in_date: string;
    check_out_date: string;
    status: ReservationStatus;
    [key: string]: unknown;
}

@Injectable()
export class TasksService {
    private readonly logger = new Logger(TasksService.name);
    private readonly workerId: string;

    constructor(
        @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
        @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
        @InjectModel(Reservation.name) private readonly reservationModel: Model<ReservationDocument>,
        @InjectConnection() private readonly connection: Connection,
        private readonly fileService: FileService,
    ) {
        this.workerId = `${os.hostname()}-${process.pid}`;
        this.logger.log(`Initialized TasksService with worker ID: ${this.workerId}`);
    }

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
        const { eventId, payload } = msg;
        this.logger.debug(`[${eventId}] Task created event received by worker ${this.workerId}`);

        if (!eventId || !payload) {
            this.logger.error('Message is missing eventId or payload. Acknowledging to prevent loop.', JSON.stringify(msg));
            return;
        }

        let session: ClientSession | undefined;

        try {
            session = await this.connection.startSession();

            let processedSuccessfully = false;
            await session.withTransaction(async () => {
                const task = await this.taskModel.findOneAndUpdate(
                    {
                        taskId: payload.taskId,
                        status: TaskStatus.PENDING
                    },
                    {
                        $set: {
                            status: TaskStatus.IN_PROGRESS,
                            startedAt: new Date(),
                            workerId: this.workerId,
                            processingAt: new Date()
                        }
                    },
                    { new: true, session }
                );

                if (!task) {
                    this.logger.warn(`Task ${payload.taskId} could not be claimed (not PENDING or doesn't exist). Acknowledging message.`);
                    processedSuccessfully = true;
                    return;
                }

                const errors: Array<{ row: number; error: string }> = [];
                try {
                    const { stream } = await this.fileService.downloadFile(task.filePath);
                    const processedIds = new Set<string>();

                    const fileBuffer = await this.fileService.streamToBuffer(stream);
                    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

                    if (!worksheet) {
                        throw new Error('XLSX file is empty or corrupted');
                    }

                    const rows = XLSX.utils.sheet_to_json<ReservationRow>(worksheet);

                    if (rows.length === 0) {
                        throw new Error('No data found in XLSX file');
                    }

                    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                        const row = rows[rowIndex];
                        const rowNumber = rowIndex + 2;
                        try {
                            if (!row.reservation_id) { errors.push({ row: rowNumber, error: 'Missing required field: reservation_id' }); continue; }
                            if (!row.guest_name) { errors.push({ row: rowNumber, error: 'Missing required field: guest_name' }); continue; }
                            if (!row.check_in_date) { errors.push({ row: rowNumber, error: 'Missing required field: check_in_date' }); continue; }
                            if (!row.check_out_date) { errors.push({ row: rowNumber, error: 'Missing required field: check_out_date' }); continue; }
                            if (!row.status) { errors.push({ row: rowNumber, error: 'Missing required field: status' }); continue; }
                            if (processedIds.has(row.reservation_id)) { errors.push({ row: rowNumber, error: `Duplicate reservation_id: ${row.reservation_id} found in the file` }); continue; }

                            const checkInDate = new Date(row.check_in_date);
                            const checkOutDate = new Date(row.check_out_date);
                            if (isNaN(checkInDate.getTime())) { errors.push({ row: rowNumber, error: `Invalid date format for check_in_date. Expected YYYY-MM-DD, got: ${row.check_in_date}` }); continue; }
                            if (isNaN(checkOutDate.getTime())) { errors.push({ row: rowNumber, error: `Invalid date format for check_out_date. Expected YYYY-MM-DD, got: ${row.check_out_date}` }); continue; }
                            if (checkOutDate <= checkInDate) { errors.push({ row: rowNumber, error: `Invalid date range: check_out_date (${row.check_out_date}) must be after check_in_date (${row.check_in_date})` }); continue; }

                            const reservationStatus = row.status as ReservationStatus;
                            if (!Object.values(ReservationStatus).includes(reservationStatus)) {
                                errors.push({ row: rowNumber, error: `Invalid reservation status: ${row.status}` });
                                continue;
                            }

                            processedIds.add(row.reservation_id);

                            await this.reservationModel.updateOne(
                                { reservationId: row.reservation_id },
                                {
                                    $set: {
                                        guestName: row.guest_name,
                                        checkInDate: checkInDate,
                                        checkOutDate: checkOutDate,
                                        status: reservationStatus
                                    }
                                },
                                { upsert: true, session }
                            );

                        } catch (rowError) {
                            errors.push({
                                row: rowNumber,
                                error: `Unexpected error processing row: ${rowError.message}`
                            });
                        }
                    }
                } catch (processingError) {
                    this.logger.error(`File processing failed for task ${task.taskId}: ${processingError.message}`);
                    errors.push({ row: 0, error: `File processing error: ${processingError.message}` });
                }

                const finalStatus = errors.length > 0 ? TaskStatus.FAILED : TaskStatus.COMPLETED;
                const taskUpdateResult = await this.taskModel.findOneAndUpdate(
                    {
                        _id: task._id
                    },
                    {
                        $set: {
                            status: finalStatus,
                            completedAt: new Date(),
                            errors: errors,
                            workerId: null,
                            processingAt: null
                        }
                    },
                    { new: true, session }
                );

                if (!taskUpdateResult) {
                    throw new Error(`Failed to update task ${task._id} status within transaction`);
                }

                const eventUpdateResult = await this.eventModel.findOneAndUpdate(
                    { _id: eventId },
                    {
                        $set: {
                            status: EventStatus.PROCESSED,
                            processedAt: new Date(),
                            error: undefined
                        }
                    },
                    { new: true, session }
                );

                if (!eventUpdateResult) {
                    this.logger.warn(`Failed to update event ${eventId} status within transaction, but task was processed.`);
                }

                this.logger.debug(`Successfully processed task ${payload.taskId} with status ${finalStatus} (${errors.length} errors)`);
                processedSuccessfully = true;

            }, {
                readConcern: { level: 'majority' },
                writeConcern: { w: 'majority' }
            });

            if (processedSuccessfully) {
                return; // ACK
            }

            this.logger.warn(`Transaction for task ${payload.taskId} completed without success flag set. Nacking.`);
            return new Nack(false);

        } catch (error) {
            this.logger.error(`Error processing task ${payload.taskId}: ${error.message}`, error.stack);

            if (error.name === 'MongoServerError' && error.code === 112) {
                this.logger.warn(`Write conflict for task ${payload.taskId}. Retrying (Nack).`);
                return new Nack(false); // NACK (requeue)
            }

            this.logger.error(`Non-retryable error for task ${payload.taskId}. Acknowledging and marking as failed.`);
            try {
                await this.taskModel.updateOne(
                    { taskId: payload.taskId },
                    {
                        $set: {
                            status: TaskStatus.FAILED,
                            completedAt: new Date(),
                            errors: [{ row: 0, error: `Transaction failed: ${error.message}` }],
                            workerId: null,
                            processingAt: null
                        }
                    }
                );
                await this.eventModel.updateOne(
                    { _id: eventId },
                    {
                        $set: {
                            status: EventStatus.PROCESSED,
                            processedAt: new Date(),
                            error: { message: `Transaction failed: ${error.message}`, stack: error.stack }
                        }
                    }
                );
            } catch (updateError) {
                this.logger.error(`Failed to update task/event status after error for task ${payload.taskId}: ${updateError.message}`);
            }
            return; // ACK
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }
}