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
        const apiKey = request.headers['X-Api-Key'] as string | undefined;
        const validApiKey = this.configService.get<string>('auth.rootApiKey');

        if (!validApiKey) {
            this.logger.error('API_ROOT_API_KEY (auth.rootApiKey) is not configured.');
            throw new UnauthorizedException('Invalid or missing API key');
        }

        if (!apiKey || apiKey !== validApiKey) {
            throw new UnauthorizedException('Invalid or missing API key');
        }

        return true;
    }
} 