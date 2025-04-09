import { Module } from "@nestjs/common";
import { TaskController } from "./controllers/task.controller";
import { TaskService } from "./services/task.service";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";

@Module({
    imports: [],
    controllers: [TaskController],
    providers: [TaskService, ApiKeyGuard],
})
export class TasksModule { }
