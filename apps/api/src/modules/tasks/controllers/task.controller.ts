import { Body, Controller, FileTypeValidator, Get, Logger, Param, ParseFilePipe, Post, UploadedFile, UseInterceptors, UseGuards, NotFoundException, Res, StreamableFile } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiSecurity } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { QueryBus } from "@nestjs/cqrs";
import { UploadReservationsDto } from "../dto/upload-reservations.dto";
import { UploadReservationsBodyDto } from "../dto/upload-reservations-body.dto";
import { ChunkReceivedResponseDto, UploadCompletedResponseDto } from "../dto/upload-response.dto";
import { TaskService } from "../services/task.service";
import { ApiKeyGuard } from "../../../common/guards/api-key.guard";
import { GetTaskStatusQuery } from "../queries/get-task-status.query";
import { TaskStatusResponseDto } from "../dto/task-status-response.dto";
import { GetFailedTaskErrorReportQuery, GetFailedTaskErrorReportResult } from "../queries/get-failed-task-error-report.query";
import { Response } from 'express';

@ApiTags('Task')
@ApiSecurity('api_key')
@UseGuards(ApiKeyGuard)
@Controller('task')
export class TaskController {
    private readonly logger = new Logger(TaskController.name);

    constructor(
        private readonly taskService: TaskService,
        private readonly queryBus: QueryBus,
    ) { }

    @ApiOperation({
        summary: 'Upload reservations in chunks',
        description: 'Upload a chunk of an XLSX file containing reservations. For intermediate chunks, returns a status. For the final chunk, returns the task ID.'
    })
    @ApiResponse({
        status: 200,
        description: 'Chunk uploaded successfully',
        type: ChunkReceivedResponseDto
    })
    @ApiResponse({
        status: 201,
        description: 'Final chunk uploaded and task created',
        type: UploadCompletedResponseDto
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request (file type, chunk number, or upload session)'
    })
    @ApiResponse({
        status: 401,
        description: 'Unauthorized - API key required'
    })
    @ApiResponse({
        status: 500,
        description: 'Internal server error during upload or task creation'
    })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        description: 'Reservations file chunk with metadata',
        type: UploadReservationsDto,
    })
    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new FileTypeValidator({ fileType: /(application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/ }),
                ],
                fileIsRequired: true,
            }),
        ) file: Express.Multer.File,
        @Body() body: UploadReservationsBodyDto,
    ): Promise<ChunkReceivedResponseDto | UploadCompletedResponseDto> {
        return this.taskService.handleFileChunk(
            file,
            body.chunkNumber,
            body.totalChunks,
            body.uploadId,
            body.originalFileName,
        );
    }

    @ApiOperation({ summary: 'Get task status', description: 'Retrieves the current status and details of a specific task.' })
    @ApiParam({ name: 'taskId', description: 'The unique ID of the task', type: String, example: 'upload_abc123' })
    @ApiResponse({ status: 200, description: 'Task status retrieved successfully', type: TaskStatusResponseDto })
    @ApiResponse({ status: 401, description: 'Unauthorized - API key required' })
    @ApiResponse({ status: 404, description: 'Task not found' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    @Get('status/:taskId')
    async getTaskStatus(
        @Param('taskId') taskId: string
    ): Promise<TaskStatusResponseDto> {
        try {
            return await this.queryBus.execute(new GetTaskStatusQuery(taskId));
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw new NotFoundException(error.message);
            }
            throw error;
        }
    }

    @ApiOperation({ summary: 'Download Task Error Report (CSV)', description: 'Generates and downloads a CSV report detailing errors for a specific FAILED task.' })
    @ApiParam({ name: 'taskId', description: 'The unique ID of the failed task', type: String })
    @ApiResponse({ status: 200, description: 'CSV error report generated successfully', content: { 'text/csv': {} } })
    @ApiResponse({ status: 401, description: 'Unauthorized - API key required' })
    @ApiResponse({ status: 404, description: 'Task not found or task status is not FAILED' })
    @ApiResponse({ status: 500, description: 'Internal server error during report generation' })
    @Get('report/:taskId')
    async getTaskErrorReport(
        @Param('taskId') taskId: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        try {
            const { errors, originalFileName }: GetFailedTaskErrorReportResult = await this.queryBus.execute(
                new GetFailedTaskErrorReportQuery(taskId)
            );

            const csvHeader = '"Row","Error"\n';
            const csvRows = errors.map(err => {
                const row = err.row !== undefined ? `"${err.row}"` : '"N/A"';
                const errorMsg = err.error ? `"${String(err.error).replace(/"/g, '""')}"` : '""';
                return `${row},${errorMsg}`;
            }).join('\n');

            const csvContent = csvHeader + csvRows;
            const fileBuffer = Buffer.from(csvContent, 'utf-8');

            const safeOriginalFileName = originalFileName.replace(/[^a-z0-9._-]/gi, '_');
            const reportFilename = `error_report_${safeOriginalFileName}.csv`;

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${reportFilename}"`);

            return new StreamableFile(fileBuffer);
        }
        catch (error) {
            if (error instanceof NotFoundException) {
                throw new NotFoundException(error.message);
            }
            this.logger.error(`Failed to generate error report for task ${taskId}: ${error.message}`, error.stack);
            throw error;
        }
    }
}