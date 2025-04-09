import { Body, Controller, FileTypeValidator, ParseFilePipe, Post, UploadedFile, UseInterceptors, UseGuards } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags, ApiSecurity } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadReservationsDto } from "../dto/upload-reservations.dto";
import { ChunkReceivedResponseDto, UploadCompletedResponseDto } from "../dto/upload-response.dto";
import { TaskService } from "../services/task.service";
import { ApiKeyGuard } from "../../../common/guards/api-key.guard";

@ApiTags('Task')
@ApiSecurity('api_key')
@UseGuards(ApiKeyGuard)
@Controller('task')
export class TaskController {
    constructor(
        private readonly taskService: TaskService,
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
            }),
        ) file: Express.Multer.File,
        @Body() dto: Omit<UploadReservationsDto, 'file'>,
    ): Promise<ChunkReceivedResponseDto | UploadCompletedResponseDto> {
        return this.taskService.handleFileChunk(
            file,
            dto.chunkNumber,
            dto.totalChunks,
            dto.uploadId,
            dto.originalFileName,
        );
    }
}