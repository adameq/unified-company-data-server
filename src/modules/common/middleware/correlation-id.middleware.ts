/**
 * Correlation ID Middleware
 *
 * Primary source of correlationId for ALL incoming HTTP requests.
 * Executes BEFORE Guards, Interceptors, and Filters in NestJS pipeline.
 *
 * Responsibilities:
 * - Extract correlationId from incoming headers (distributed tracing)
 * - Generate new correlationId if none provided (standalone operation)
 * - Attach correlationId to request object for downstream use
 * - Add correlationId to response headers for client tracking
 *
 * Execution Order:
 * Middleware → Guards → Interceptors → Controllers → Filters
 *
 * Benefits:
 * - Guards have access to correlationId (auth errors tracked)
 * - Interceptors can log without generating ID
 * - Filters use existing ID (no fallback generation needed in 99% cases)
 * - Consistent ID format across entire request lifecycle
 */

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  generateCorrelationId,
  extractFromHeaders,
} from '../utils/correlation-id.utils';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CorrelationIdMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    // Try to extract ID from upstream service (distributed tracing)
    const existingId = extractFromHeaders(req);

    // Use existing ID or generate new one
    const correlationId = existingId || generateCorrelationId();

    // Attach to request object for downstream components
    // Type-safe thanks to Express.Request extension in src/types/express.d.ts
    req.correlationId = correlationId;

    // Add to response headers for client tracking
    res.setHeader('X-Correlation-ID', correlationId);

    // Log ID source for debugging
    if (existingId) {
      this.logger.debug(`Using external correlation ID: ${correlationId}`, {
        source: 'upstream-header',
      });
    } else {
      this.logger.debug(`Generated new correlation ID: ${correlationId}`, {
        source: 'middleware',
      });
    }

    next();
  }
}
