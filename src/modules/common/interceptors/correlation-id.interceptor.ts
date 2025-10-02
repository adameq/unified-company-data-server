import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { extractFromRequest } from '../utils/correlation-id.utils';

/**
 * Correlation ID Interceptor
 *
 * Logs requests with correlation tracking.
 *
 * NOTE: correlationId is now managed by CorrelationIdMiddleware (executes earlier).
 * This interceptor only handles LOGGING of requests.
 *
 * Features:
 * - Logs request start and completion with correlation tracking
 * - Tracks request duration
 * - Logs errors with correlation context
 * - Detects and warns about slow requests (>5 seconds)
 *
 * Architecture:
 * Middleware (generates/extracts ID) → Interceptor (logs with ID) → Controller
 *
 * Use cases:
 * - Request/response logging for debugging
 * - Performance monitoring (request duration)
 * - Error tracking with correlation context
 * - Slow request detection
 *
 * @example
 * // All requests are automatically logged with correlationId
 * [CorrelationIdInterceptor] Request started {correlationId: "req-abc123", method: "POST", path: "/api/companies"}
 * [CorrelationIdInterceptor] Request completed successfully {correlationId: "req-abc123", duration: 245}
 */

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CorrelationIdInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Read correlationId from request (set by Middleware)
    const correlationId =
      extractFromRequest(request) || 'unknown-interceptor-fallback';

    // Log request start
    const startTime = Date.now();
    this.logRequestStart(request, correlationId);

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequestCompletion(
            request,
            response,
            correlationId,
            startTime,
            'success',
          );
        },
        error: (error) => {
          this.logRequestCompletion(
            request,
            response,
            correlationId,
            startTime,
            'error',
            error,
          );
        },
      }),
    );
  }

  /**
   * Log request start
   */
  private logRequestStart(request: Request, correlationId: string): void {
    const { method, path, ip } = request;
    const userAgent = request.headers['user-agent'];

    this.logger.log('Request started', {
      correlationId,
      method,
      path,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log request completion
   */
  private logRequestCompletion(
    request: Request,
    response: Response,
    correlationId: string,
    startTime: number,
    status: 'success' | 'error',
    error?: any,
  ): void {
    const duration = Date.now() - startTime;
    const { method, path } = request;
    const statusCode = response.statusCode;

    const logData = {
      correlationId,
      method,
      path,
      statusCode,
      duration,
      status,
      timestamp: new Date().toISOString(),
    };

    if (status === 'error') {
      this.logger.error('Request completed with error', {
        ...logData,
        error: {
          message: (error as Error)?.message || 'Unknown error',
          errorCode: (error as { errorCode?: string })?.errorCode,
          stack: (error as Error)?.stack,
        },
      });
    } else {
      // Log as warning for slow requests (>5 seconds)
      if (duration > 5000) {
        this.logger.warn('Slow request completed', logData);
      } else {
        this.logger.log('Request completed successfully', logData);
      }
    }
  }
}
