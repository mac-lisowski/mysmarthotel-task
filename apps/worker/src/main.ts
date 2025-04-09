import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { Transport } from '@nestjs/microservices';
import { MicroserviceOptions } from '@nestjs/microservices';
import config from './worker.config';
import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';

async function bootstrap() {
  const logger = new Logger('Worker');

  const configWorker = config();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(WorkerModule, {
    transport: Transport.RMQ,
    options: {
      urls: [configWorker.rabbitmq.url],
      queue: 'smarthotel_queue',
      queueOptions: {
        durable: true,
      },
      prefetchCount: 1,
    },
    logger: configWorker.worker.logger
      ? [String(configWorker.worker.logger) as LogLevel]
      : ['verbose'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  useContainer(app.select(WorkerModule), { fallbackOnErrors: true });

  const signals = ['SIGTERM', 'SIGINT'];

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, starting graceful shutdown...`);
      await app.close();

      logger.log('Worker service closed');
      process.exit(0);
    });
  }

  await app.listen();

  logger.log('Worker microservice is listening for messages');
}

bootstrap();
