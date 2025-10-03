import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  Inject,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { Environment } from '@config/environment.schema';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { extractFromRequest } from '../utils/correlation-id.utils';
import { extractBearerToken, maskApiKey } from '../utils/auth.utils';
import { BusinessException } from '@common/exceptions/business-exceptions';

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
export class ApiKeyGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private validApiKeys!: Set<string>;

  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService<Environment, true>,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Module initialization hook - load API keys once at startup
   *
   * Called by NestJS after dependency injection is complete.
   * ConfigService is fully initialized and environment variables are validated.
   *
   * Performance impact:
   * - Before: Lazy init checked on EVERY request (if statement + potential load)
   * - After: Eager init executed ONCE at module startup
   */
  async onModuleInit() {
    // Get API keys from ConfigService - already transformed by Zod schema
    // ConfigService returns string[] (parsed and validated by environment.schema.ts)
    const apiKeys = this.configService.get('APP_API_KEYS', { infer: true });

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

    if (!this.validApiKeys.has(apiKey)) {
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
   * Fail-fast: throws error if ID is missing (indicates misconfiguration)
   * ID MUST be set by CorrelationIdMiddleware (executes before Guards)
   */
  private getCorrelationId(request: Request): string {
    const id = extractFromRequest(request);

    if (!id) {
      // Fail-fast: Middleware did not execute - critical configuration error
      this.logger.error('CRITICAL: Correlation ID missing in guard', {
        path: request.path,
        method: request.method,
        middlewareStatus: 'NOT_EXECUTED',
      });

      throw new InternalServerErrorException(
        'Correlation ID middleware not executed',
      );
    }

    return id;
  }

}
