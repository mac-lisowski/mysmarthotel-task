import { IQuery } from '@nestjs/cqrs';

export class GetFailedTaskErrorReportQuery implements IQuery {
    constructor(public readonly taskId: string) { }
}

export interface GetFailedTaskErrorReportResult {
    errors: Record<string, any>[];
    originalFileName: string;
} 