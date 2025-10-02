import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { Environment } from '../../../config/environment.schema';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { extractFromRequest } from '../utils/correlation-id.utils';
import { extractBearerToken, maskApiKey } from '../utils/auth.utils';
import { BusinessException } from '../../../common/exceptions/business-exceptions';

/**
 * API Key Authentication Guard
 *
 * Validates API keys for request authentication using Bearer token standard.
 * Supports multiple valid API keys for different clients.
 *
 * Expected header format:
 * - Authorization: Bearer <api-key>
 */

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private validApiKeys: Set<string> | null = null;

  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService<Environment, true>,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Lazy initialization of API keys
   * Called on first request to ensure ConfigService has loaded environment
   */
  private initializeApiKeys(): void {
    if (this.validApiKeys !== null) {
      return; // Already initialized
    }

    // Get API keys from ConfigService - already transformed by Zod schema
    // ConfigService now returns string[] (parsed and validated by environment.schema.ts)
    const apiKeys = this.configService.get('VALID_API_KEYS', { infer: true }) || [];

    if (apiKeys.length === 0) {
      this.logger.warn(
        'No valid API keys configured - all requests will be rejected',
      );
    }

    this.validApiKeys = new Set(apiKeys);

    this.logger.log(
      `API Key guard initialized with ${this.validApiKeys.size} valid keys`,
    );
    this.logger.debug(
      `Valid API keys loaded: ${this.validApiKeys.size} keys configured`,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    // Lazy initialization: load API keys on first request
    this.initializeApiKeys();

    // Check if endpoint is marked as public using @Public() decorator
    // Uses Reflector to check metadata at both handler and class level
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const correlationId = this.getCorrelationId(request);

    const apiKey = extractBearerToken(request);

    if (!apiKey) {
      this.logger.warn('Request missing API key', {
        correlationId,
        path: request.path,
        method: request.method,
        ip: request.ip,
      });

      throw new BusinessException({
        errorCode: 'MISSING_API_KEY',
        message:
          'API key is required. Provide it in Authorization header as Bearer token.',
        correlationId,
        source: 'INTERNAL',
      });
    }

    if (!this.validApiKeys!.has(apiKey)) {
      this.logger.warn('Request with invalid API key', {
        correlationId,
        path: request.path,
        method: request.method,
        ip: request.ip,
        apiKeyPrefix: maskApiKey(apiKey),
      });

      throw new BusinessException({
        errorCode: 'INVALID_API_KEY',
        message: 'Invalid API key provided.',
        correlationId,
        source: 'INTERNAL',
      });
    }

    this.logger.debug('API key authentication successful', {
      correlationId,
      path: request.path,
      method: request.method,
      apiKeyPrefix: maskApiKey(apiKey),
    });

    return true;
  }

  /**
   * Get correlation ID from request object
   * ID is set by CorrelationIdMiddleware (executes before Guards)
   */
  private getCorrelationId(request: Request): string {
    // Read from request object (set by Middleware)
    return extractFromRequest(request) || 'unknown-guard-fallback';
  }

}
