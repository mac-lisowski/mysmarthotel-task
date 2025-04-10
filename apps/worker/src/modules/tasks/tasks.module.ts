import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { DatabaseModule } from "@database";
import { FilesModule } from "@files";

@Module({
    imports: [
        DatabaseModule,
        FilesModule,
    ],
    providers: [TasksService]
})
export class TasksModule { }