import { Module } from "@nestjs/common";

@Module({
    imports: [
        // MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    ],
})
export class TasksModule { }
