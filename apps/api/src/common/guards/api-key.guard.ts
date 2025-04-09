import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    private readonly logger = new Logger(ApiKeyGuard.name);
    constructor(private readonly configService: ConfigService) { }

    canActivate(
        context: ExecutionContext,
    ): boolean | Promise<boolean> | Observable<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const receivedApiKey = request.headers['x-api-key'] as string | undefined;
        const expectedApiKey = this.configService.get<string>('auth.rootApiKey');

        if (!expectedApiKey) {
            this.logger.error('API_ROOT_API_KEY (auth.rootApiKey) is not configured.');
            throw new UnauthorizedException('API Key configuration error');
        }

        if (!receivedApiKey || receivedApiKey !== expectedApiKey) {
            throw new UnauthorizedException('Invalid or missing API key');
        }

        return true;
    }
} 