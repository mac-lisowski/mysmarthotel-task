import { Body, Controller, FileTypeValidator, ParseFilePipe, Post, UploadedFile, UseInterceptors, UseGuards } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags, ApiSecurity } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadReservationsDto } from "../dto/upload-reservations.dto";
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

    @ApiOperation({ summary: 'Upload reservations in chunks' })
    @ApiResponse({ status: 200, description: 'Chunk uploaded successfully' })
    @ApiResponse({ status: 400, description: 'Invalid file type or size' })
    @ApiResponse({ status: 401, description: 'Unauthorized - API key required' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        description: 'Reservations file chunk',
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
    ) {
        return this.taskService.handleFileChunk(
            file,
            dto.chunkNumber,
            dto.totalChunks,
            dto.uploadId,
            dto.originalFileName,
        );
    }
}