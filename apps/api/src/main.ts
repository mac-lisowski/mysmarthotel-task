import { NestFactory } from '@nestjs/core';
import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import config from './api.config';
import { ApiModule } from './api.module';
import { useContainer } from 'class-validator';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const logger = new Logger('Api');
  const configApi = config();

  const app = await NestFactory.create(
    ApiModule,
    {
      rawBody: true,
      logger: configApi.app.logger
        ? [String(configApi.app.logger) as LogLevel]
        : ['verbose'],
    },
  );
  app.use(compression({ filter: shouldCompress as any }));
  app.setGlobalPrefix('v1');

  const corsOrigins = configApi.app.env === 'production'
    ? ['*'] // Could be a list of allowed origins in production
    : '*';

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, x-api-key',
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    }),
  );

  useContainer(app.select(ApiModule), { fallbackOnErrors: true });

  if (configApi.app.env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SmartHotel Task API')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
      }, 'api_key')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('_docs', app, document);
  }

  const signals = ['SIGTERM', 'SIGINT'];

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, starting graceful shutdown...`);
      await app.close();

      logger.log('Worker service closed');
      process.exit(0);
    });
  }

  await app.listen(configApi.app.port, configApi.app.host);
}

function shouldCompress(req: Request, res: Response): boolean {
  if ((req.headers as any)['x-no-compression']) {
    return false;
  }
  return compression.filter(req as any, res as any);
}

bootstrap();
