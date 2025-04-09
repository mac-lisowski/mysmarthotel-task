import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
    private readonly logger = new Logger(ApiKeyStrategy.name);

    constructor(
        private readonly configService: ConfigService,
    ) {
        super();
    }

    async validate(req: Request): Promise<boolean> {
        const providedKey = req.headers['X-Api-Key'] as string | undefined;

        if (!providedKey) {
            throw new UnauthorizedException('Missing API key');
        }

        try {
            const validApiKey = this.configService.get<string>('auth.rootApiKey');

            if (!validApiKey) {
                this.logger.error('Root API Key (auth.rootApiKey) is not configured.');
                throw new UnauthorizedException('API Key configuration error.');
            }

            if (providedKey === validApiKey) {
                return true;
            }

            throw new UnauthorizedException('Invalid API key');
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }

            this.logger.error(`Error validating API key: ${error.message}`);
            throw new UnauthorizedException('Error validating API key');
        }
    }
} 