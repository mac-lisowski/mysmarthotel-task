export abstract class BaseEvent<T> {
    /**
     * event name
     *
     * @dev example: `user.created.event`
     */
    readonly eventName: string;

    /**
     * payload
     */
    readonly payload: T;

    /**
     * constructor
     * @param payload payload
     */
    constructor(payload: T) {
        this.payload = payload;
    }
}
