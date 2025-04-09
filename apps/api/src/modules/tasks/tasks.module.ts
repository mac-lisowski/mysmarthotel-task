import { Module } from "@nestjs/common";
import { TaskController } from "./controllers/task.controller";
import { TaskService } from "./services/task.service";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";
import { FilesModule } from "@files";

@Module({
    imports: [FilesModule],
    controllers: [TaskController],
    providers: [TaskService, ApiKeyGuard],
})
export class TasksModule { }
