import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for public endpoints
 * Used by ApiKeyGuard to identify routes that should skip authentication
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Public Endpoint Decorator
 *
 * Marks a route handler or controller as publicly accessible,
 * bypassing API key authentication in ApiKeyGuard.
 *
 * This decorator follows standard NestJS metadata patterns and provides:
 * - Declarative endpoint security configuration
 * - Type-safe route protection
 * - Centralized authentication logic in guards
 * - Easy maintenance (no hardcoded path lists)
 *
 * Usage:
 * - Apply to route handlers to make specific endpoints public
 * - Apply to controllers to make all routes public
 * - Handler-level decorators override controller-level decorators
 *
 * @example
 * ```typescript
 * // Single public endpoint in protected controller
 * @Controller('api/users')
 * export class UsersController {
 *   @Get('profile')
 *   getProfile() {} // Protected - requires API key
 *
 *   @Public()
 *   @Get('health')
 *   getHealth() {} // Public - no API key required
 * }
 *
 * // Entire controller is public
 * @Public()
 * @Controller('api/health')
 * export class HealthController {
 *   @Get()
 *   getHealth() {} // Public
 *
 *   @Get('ready')
 *   getReadiness() {} // Public
 * }
 * ```
 *
 * Implementation:
 * The ApiKeyGuard checks for this metadata using NestJS Reflector:
 * - Checks handler-level metadata first
 * - Falls back to controller-level metadata
 * - If IS_PUBLIC_KEY is true, skips authentication
 *
 * @returns SetMetadata decorator that marks endpoint as public
 * @see ApiKeyGuard
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
