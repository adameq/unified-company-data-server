import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiKeyGuard } from './guards/api-key.guard';
import {
  CustomThrottlerGuard,
  ThrottlerConfigService,
} from './config/throttler.config';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { CorrelationIdInterceptor } from './interceptors/correlation-id.interceptor';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { AxiosErrorHandler } from './handlers/axios-error.handler';

/**
 * Common Module
 *
 * Shared infrastructure and cross-cutting concerns:
 * - Correlation ID tracking (Middleware - executes first)
 * - API key authentication (Guards)
 * - Rate limiting with throttling (Guards)
 * - Request/response logging (Interceptors)
 * - Global exception handling (Filters)
 *
 * Request Pipeline Order:
 * 1. Middleware (CorrelationIdMiddleware) - generates/extracts correlationId
 * 2. Guards (ApiKeyGuard, CustomThrottlerGuard) - authentication, rate limiting
 * 3. Interceptors (CorrelationIdInterceptor) - request/response logging
 * 4. Controllers - business logic
 * 5. Filters (GlobalExceptionFilter) - error handling
 *
 * This module provides the foundational middleware and services
 * that are used across the entire application.
 *
 * Note: HealthController was moved to CompaniesModule to avoid circular dependency.
 * CommonModule no longer depends on any business logic modules.
 */

@Module({
  imports: [
    // Configure throttling/rate limiting
    ThrottlerModule.forRootAsync({
      useClass: ThrottlerConfigService,
    }),
  ],
  controllers: [],
  providers: [
    // Global API key authentication
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    // Global rate limiting
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    // Global correlation ID tracking
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
    // Global exception handling
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // Configuration services
    ThrottlerConfigService,
    // Error handlers
    AxiosErrorHandler,
  ],
  exports: [
    // Export shared services for other modules
    ThrottlerConfigService,
    AxiosErrorHandler,
  ],
})
export class CommonModule implements NestModule {
  /**
   * Configure Middleware for all routes
   * Middleware executes BEFORE Guards, Interceptors, and Filters
   */
  configure(consumer: MiddlewareConsumer): void {
    // Register CorrelationIdMiddleware for ALL routes
    // This ensures every HTTP request has a correlationId before reaching Guards/Interceptors
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
