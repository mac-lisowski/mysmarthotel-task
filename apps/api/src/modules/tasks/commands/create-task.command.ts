interface CreateTaskCommandPayload {
    s3ObjectKey: string;
    originalFileName: string;
}

export class CreateTaskCommand {
    constructor(public readonly payload: CreateTaskCommandPayload) { }
} 