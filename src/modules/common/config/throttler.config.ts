import { Injectable, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerOptionsFactory,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { Request } from 'express';
import { createHash } from 'crypto';
import { type Environment } from '@config/environment.schema';
import { extractBearerToken, maskApiKey } from '../utils/auth.utils';

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

    return {
      throttlers: [
        {
          name: 'default',
          ttl: 60 * 1000, // 1 minute in milliseconds
          limit: rateLimitPerMinute,
        },
        {
          name: 'burst', // Allow short bursts but with stricter overall limit
          ttl: 10 * 1000, // 10 seconds
          limit: Math.min(10, Math.floor(rateLimitPerMinute / 6)), // Max 10 requests per 10 seconds
        },
      ],
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
 * Custom throttler guard with enhanced error responses
 */
import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable as GuardInjectable } from '@nestjs/common';
import { BusinessException } from '@common/exceptions/business-exceptions';

@GuardInjectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract correlation ID from headers (string | string[] → string)
    const correlationIdHeader = request.headers['correlation-id'] || request.headers['x-correlation-id'];
    const correlationId = Array.isArray(correlationIdHeader)
      ? correlationIdHeader[0]
      : correlationIdHeader || `rate-limit-${Date.now()}`;

    const apiKey = extractBearerToken(request);

    throw new BusinessException({
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message:
        'API rate limit exceeded. Please reduce request frequency and try again.',
      correlationId,
      source: 'INTERNAL',
      details: {
        clientIdentifier: apiKey
          ? maskApiKey(apiKey)
          : request.ip,
        path: request.path,
        method: request.method,
        retryAfter: '60', // Suggest retry after 60 seconds
      },
    });
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

/**
 * Rate limiting utility functions
 */
export const RateLimitUtils = {
  /**
   * Check if an IP address should be allowed higher limits (e.g., internal IPs)
   */
  isPrivilegedIP: (ip: string): boolean => {
    // Private IP ranges
    const privateRanges = [
      /^127\./, // Loopback
      /^10\./, // Class A private
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
      /^192\.168\./, // Class C private
      /^::1$/, // IPv6 loopback
      /^fc00:/, // IPv6 unique local
    ];

    return privateRanges.some((range) => range.test(ip));
  },

  /**
   * Calculate dynamic rate limit based on client type
   */
  getDynamicLimit: (
    baseLimit: number,
    apiKey?: string,
    ip?: string,
  ): number => {
    // Internal IPs get 5x higher limits
    if (ip && RateLimitUtils.isPrivilegedIP(ip)) {
      return baseLimit * 5;
    }

    // API key clients get 2x higher limits
    if (apiKey) {
      return baseLimit * 2;
    }

    return baseLimit;
  },

  /**
   * Format rate limit headers for response
   */
  formatRateLimitHeaders: (
    limit: number,
    remaining: number,
    resetTime: number,
  ) => ({
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetTime.toString(),
    'Retry-After': Math.ceil((resetTime - Date.now()) / 1000).toString(),
  }),
};
