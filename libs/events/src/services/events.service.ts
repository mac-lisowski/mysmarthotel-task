import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ClientSession, Model } from 'mongoose';
import { Event, EventDocument, EventStatus } from "@database/database";
import { BaseEvent } from "../events/base-event";

@Injectable()
export class EventsService {
    constructor(
        @InjectModel(Event.name) private eventModel: Model<Event>,
    ) { }

    /**
     * Save an event in database
     * @param event The event to save
     * @returns The saved event
     */
    async saveEvent<T>(event: BaseEvent<T>, session?: ClientSession): Promise<EventDocument> {
        const newEvent = new this.eventModel({
            eventName: event.eventName,
            event: event,
            status: EventStatus.NEW
        });

        return await newEvent.save({ session: session || undefined });
    }
}