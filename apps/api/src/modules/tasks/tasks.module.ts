import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { TaskController } from "./controllers/task.controller";
import { TaskService } from "./services/task.service";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";
import { FilesModule } from "@files";
import { CreateTaskHandler } from "./commands/create-task.handler";
import { GetTaskStatusHandler } from "./queries/get-task-status.handler";

@Module({
    imports: [
        FilesModule,
        CqrsModule,
    ],
    controllers: [TaskController],
    providers: [
        TaskService,
        ApiKeyGuard,
        CreateTaskHandler,
        GetTaskStatusHandler
    ],
})
export class TasksModule { }
