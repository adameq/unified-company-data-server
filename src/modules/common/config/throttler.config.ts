import { Injectable, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerOptionsFactory,
  ThrottlerModuleOptions,
  ThrottlerGuard,
  ThrottlerException,
} from '@nestjs/throttler';
import { Request } from 'express';
import { createHash } from 'crypto';
import { type Environment } from '@config/environment.schema';
import { extractBearerToken, maskApiKey } from '../utils/auth.utils';
import { getThrottlerConfigsArray } from './throttler-limits.helper';

/**
 * Hash API key for rate limiting identification
 *
 * Uses SHA256 to create a unique, secure identifier from API key.
 * This prevents:
 * - Collision: Two different API keys with same prefix won't share limits
 * - Security: API key fragments don't appear in logs/metrics
 * - Predictability: Changing key prefix doesn't affect identifier
 *
 * @param apiKey - Full API key to hash
 * @returns First 16 characters of SHA256 hash (sufficient for uniqueness)
 */
function hashApiKeyForRateLimit(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
}

/**
 * Throttler Configuration for Rate Limiting
 *
 * Implements rate limiting to protect against abuse and ensure fair usage.
 * Configurable limits per time window with different strategies.
 */

@Injectable()
export class ThrottlerConfigService implements ThrottlerOptionsFactory {
  constructor(private readonly configService: ConfigService<Environment, true>) {}

  createThrottlerOptions(): ThrottlerModuleOptions {
    // Get rate limit from environment (requests per minute)
    const rateLimitPerMinute = this.configService.get('APP_RATE_LIMIT_PER_MINUTE', { infer: true });

    // Use centralized helper to calculate throttler limits
    // This ensures consistency across production, tests, and test configuration
    const throttlers = getThrottlerConfigsArray(rateLimitPerMinute);

    return {
      throttlers,
      // Storage configuration for distributed systems
      storage: undefined, // Use in-memory storage for single instance, Redis for distributed

      /**
       * Skip rate limiting for specific conditions
       *
       * IMPORTANT: Rate limiting is DISABLED in development/test environments by design.
       * This allows developers to work without artificial request limits and enables
       * integration tests to run without hitting rate limits.
       *
       * Rate limiting IS ACTIVE in production (NODE_ENV=production).
       *
       * Why skip in dev/test:
       * - Development: Developers need unlimited requests for debugging and testing
       * - Test: Integration tests may make many rapid requests to external APIs
       * - Production: Rate limiting protects against abuse and ensures fair usage
       *
       * To test rate limiting behavior:
       * - Set NODE_ENV=production (or custom test environment)
       * - Or modify this skipIf function for specific test scenarios
       */
      skipIf: (context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest<Request>();
        const path = request.path;

        // Skip rate limiting for health check endpoints (all environments)
        if (path?.startsWith('/api/health')) {
          return true;
        }

        // Skip rate limiting in development and test environments
        // Rate limiting IS ACTIVE in production
        if (
          process.env.NODE_ENV === 'test' ||
          process.env.NODE_ENV === 'development'
        ) {
          return true;
        }

        return false;
      },

      // Generate unique identifier for each client
      generateKey: (context: ExecutionContext, trackerName: string) => {
        const request = context.switchToHttp().getRequest<Request>();

        // Use API key as identifier if available, otherwise fall back to IP
        const apiKey = extractBearerToken(request);
        if (apiKey) {
          const apiKeyHash = hashApiKeyForRateLimit(apiKey);
          return `${trackerName}:${apiKeyHash}`;
        }

        // Fall back to IP address
        const ip = request.ip || 'unknown';
        return `${trackerName}:${ip}`;
      },

      // Error message configuration
      errorMessage: 'Rate limit exceeded. Please try again later.',
    };
  }
}

/**
 * Custom throttler guard with clean separation of concerns
 *
 * Responsibilities:
 * - Rate limit enforcement (control access)
 * - Client identification (API key or IP)
 *
 * NOT responsible for:
 * - Error response formatting (handled by ThrottlerExceptionHandler)
 * - RetryAfter calculation (handled by ThrottlerExceptionHandler)
 *
 * This follows Single Responsibility Principle and enables
 * centralized error response management via GlobalExceptionFilter.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = extractBearerToken(request);

    // Throw standard ThrottlerException with request context
    // ThrottlerExceptionHandler will convert to business ErrorResponse
    const exception = new ThrottlerException();

    // Attach request context to exception response for handler
    (exception as any).clientIdentifier = apiKey ? maskApiKey(apiKey) : request.ip;
    (exception as any).path = request.path;
    (exception as any).method = request.method;

    throw exception;
  }

  protected async getTracker(req: Request): Promise<string> {
    // Use API key for tracking if available
    const apiKey = extractBearerToken(req);
    if (apiKey) {
      return hashApiKeyForRateLimit(apiKey);
    }

    // Fall back to IP address
    return req.ip || 'unknown';
  }
}
