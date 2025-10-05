/**
 * Throttler Limits Helper
 *
 * Centralized rate limiting configuration calculations.
 * Provides Single Source of Truth for rate limit values across:
 * - Production configuration (throttler.config.ts)
 * - Test configuration (test-app-setup.ts)
 * - Integration tests (rate-limiting.spec.ts)
 *
 * Benefits:
 * - No magic numbers in tests
 * - Consistent rate limiting behavior across environments
 * - Easy to update limits (change in one place)
 * - Type-safe configuration
 *
 * @module throttler-limits.helper
 */

/**
 * Throttler configuration for a single rate limit window
 */
export interface ThrottlerConfig {
  /**
   * Name of the throttler (e.g., 'default', 'burst')
   */
  name: string;

  /**
   * Time-to-live in milliseconds (window duration)
   */
  ttl: number;

  /**
   * Maximum number of requests allowed in the window
   */
  limit: number;
}

/**
 * Complete throttler configuration with all windows
 */
export interface ThrottlerLimits {
  /**
   * Default throttler (long-term limit)
   * Example: 100 requests per minute
   */
  default: ThrottlerConfig;

  /**
   * Burst throttler (short-term limit)
   * Example: 10 requests per 10 seconds
   */
  burst: ThrottlerConfig;
}

/**
 * Calculate default throttler configuration (long-term limit)
 *
 * @param rateLimitPerMinute - Maximum requests allowed per minute
 * @returns Default throttler configuration with 60-second window
 *
 * @example
 * const defaultLimit = calculateDefaultLimit(100);
 * // Returns: { name: 'default', ttl: 60000, limit: 100 }
 */
export function calculateDefaultLimit(
  rateLimitPerMinute: number,
): ThrottlerConfig {
  return {
    name: 'default',
    ttl: 60 * 1000, // 1 minute in milliseconds
    limit: rateLimitPerMinute,
  };
}

/**
 * Calculate burst throttler configuration (short-term limit)
 *
 * Prevents short bursts of requests from overwhelming the system.
 * Uses a conservative calculation to allow some flexibility while
 * preventing abuse.
 *
 * Formula: Math.min(10, Math.floor(rateLimitPerMinute / 6))
 * - Dividing by 6 means ~10 seconds worth of requests (60s / 6 = 10s)
 * - Max of 10 prevents excessive bursts even with high rate limits
 *
 * Examples:
 * - 100 req/min → 10 req/10s (100/6 = 16.67, capped at 10)
 * - 60 req/min → 10 req/10s (60/6 = 10)
 * - 30 req/min → 5 req/10s (30/6 = 5)
 * - 12 req/min → 2 req/10s (12/6 = 2)
 *
 * @param rateLimitPerMinute - Maximum requests allowed per minute
 * @returns Burst throttler configuration with 10-second window
 *
 * @example
 * const burstLimit = calculateBurstLimit(100);
 * // Returns: { name: 'burst', ttl: 10000, limit: 10 }
 *
 * @example
 * const burstLimit = calculateBurstLimit(30);
 * // Returns: { name: 'burst', ttl: 10000, limit: 5 }
 */
export function calculateBurstLimit(
  rateLimitPerMinute: number,
): ThrottlerConfig {
  return {
    name: 'burst',
    ttl: 10 * 1000, // 10 seconds in milliseconds
    limit: Math.min(10, Math.floor(rateLimitPerMinute / 6)),
  };
}

/**
 * Calculate complete throttler configuration
 *
 * Combines default and burst throttler configurations.
 * This is the primary function to use for creating throttler options.
 *
 * @param rateLimitPerMinute - Maximum requests allowed per minute
 * @returns Complete throttler configuration with both default and burst limits
 *
 * @example
 * const limits = calculateThrottlerLimits(100);
 * // Returns:
 * // {
 * //   default: { name: 'default', ttl: 60000, limit: 100 },
 * //   burst: { name: 'burst', ttl: 10000, limit: 10 }
 * // }
 *
 * @example
 * // Usage in NestJS ThrottlerModule configuration
 * const limits = calculateThrottlerLimits(100);
 * return {
 *   throttlers: [limits.default, limits.burst],
 * };
 */
export function calculateThrottlerLimits(
  rateLimitPerMinute: number,
): ThrottlerLimits {
  return {
    default: calculateDefaultLimit(rateLimitPerMinute),
    burst: calculateBurstLimit(rateLimitPerMinute),
  };
}

/**
 * Get throttler configurations as array for NestJS ThrottlerModule
 *
 * Convenience function to get throttler configurations in the format
 * expected by NestJS ThrottlerModule (array of ThrottlerConfig).
 *
 * @param rateLimitPerMinute - Maximum requests allowed per minute
 * @returns Array of throttler configurations [default, burst]
 *
 * @example
 * // In throttler.config.ts
 * const throttlers = getThrottlerConfigsArray(100);
 * return { throttlers };
 *
 * @example
 * // In test-app-setup.ts
 * const throttlers = getThrottlerConfigsArray(rateLimitPerMinute);
 * return {
 *   throttlers,
 *   skipIf: ...,
 *   generateKey: ...
 * };
 */
export function getThrottlerConfigsArray(
  rateLimitPerMinute: number,
): ThrottlerConfig[] {
  const limits = calculateThrottlerLimits(rateLimitPerMinute);
  return [limits.default, limits.burst];
}
