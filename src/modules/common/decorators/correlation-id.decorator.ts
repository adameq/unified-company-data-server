import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Correlation ID Parameter Decorator
 *
 * Extracts the correlation ID from the request object that was added
 * by the CorrelationIdMiddleware.
 *
 * Type-safe: Uses Express.Request extension from src/types/express.d.ts
 *
 * This decorator follows NestJS best practices by:
 * - Decoupling controller from Express Request object
 * - Making controllers framework-agnostic and easier to test
 * - Providing a clean, declarative API for accessing correlation IDs
 *
 * @example
 * ```typescript
 * @Post()
 * async createResource(
 *   @Body() dto: CreateDto,
 *   @CorrelationId() correlationId: string
 * ) {
 *   // Use correlationId directly as a string
 *   return this.service.create(dto, correlationId);
 * }
 * ```
 *
 * @returns The correlation ID string from the request
 * @throws Will return undefined if CorrelationIdMiddleware is not configured
 */
export const CorrelationId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();

    // Extract correlation ID that was added by CorrelationIdMiddleware
    // Type-safe access thanks to Express.Request extension
    return request.correlationId;
  },
);
