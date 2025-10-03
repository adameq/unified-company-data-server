import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getHttpStatusForErrorCode } from '../../../schemas/error-response.schema';
import {
  extractFromRequest,
  generateCorrelationId,
} from '../utils/correlation-id.utils';
import { ExceptionHandlerRegistry } from './exception-handlers.registry';

/**
 * Global Exception Filter (Refactored)
 *
 * Catches all unhandled exceptions and converts them to standardized error responses
 * using a strategy pattern for clean, maintainable error handling.
 *
 * Architecture:
 * - Uses ExceptionHandlerRegistry for declarative handler selection
 * - Each exception type has a dedicated handler (single responsibility)
 * - Easy to extend with new exception types (open/closed principle)
 * - Centralized HTTP status mapping (DRY principle)
 *
 * Type-safe: Uses Express.Request extension from src/types/express.d.ts
 */

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Extract correlation ID from request
    const correlationId = this.getCorrelationId(request);

    // Log the exception with context
    this.logException(exception, request, correlationId);

    // Find appropriate handler and convert to ErrorResponse
    const handler = ExceptionHandlerRegistry.findHandler(exception);
    const errorResponse = handler.handle(exception, correlationId);

    // Map ErrorCode to HTTP status
    const statusCode = getHttpStatusForErrorCode(errorResponse.errorCode);

    // Send error response
    response.status(statusCode).json(errorResponse);
  }

  /**
   * Extract correlation ID from request
   * Safety net: generates ID only for edge cases (WebSockets, GraphQL, etc.)
   * For HTTP requests, ID should already be set by CorrelationIdMiddleware
   *
   * Type-safe: Uses Express.Request extension from src/types/express.d.ts
   */
  private getCorrelationId(request: Request): string {
    // Read from request object (set by Middleware for HTTP requests)
    const id = extractFromRequest(request);

    if (id) {
      return id;
    }

    // Safety net: generate ID for non-HTTP contexts (WebSockets, GraphQL)
    // This should NOT happen for standard HTTP requests
    const generatedId = generateCorrelationId();
    this.logger.warn(
      'Correlation ID missing - generated fallback (indicates Middleware not executed)',
      {
        generatedId,
        path: request.path,
        context: 'Could be WebSocket, GraphQL, or Middleware configuration issue',
      },
    );

    return generatedId;
  }

  /**
   * Log the exception with context
   *
   * Simplified logging - delegates exception type detection to handlers
   */
  private logException(
    exception: unknown,
    request: Request,
    correlationId: string,
  ): void {
    const { method, path, ip } = request;
    const userAgent = request.headers['user-agent'];

    const logContext = {
      correlationId,
      method,
      path,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.message;

      // Log client errors (4xx) as warnings, server errors (5xx) as errors
      if (status >= 500) {
        this.logger.error(`HTTP ${status} Server Error: ${message}`, {
          ...logContext,
          statusCode: status,
          exception: {
            name: exception.constructor.name,
            message,
            stack: exception.stack,
          },
        });
      } else {
        this.logger.warn(`HTTP ${status} Client Error: ${message}`, {
          ...logContext,
          statusCode: status,
          exception: {
            name: exception.constructor.name,
            message,
          },
        });
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled Error: ${exception.message}`, {
        ...logContext,
        exception: {
          name: exception.constructor.name,
          message: exception.message,
          stack: exception.stack,
        },
      });
    } else {
      this.logger.error('Unknown Exception', {
        ...logContext,
        exception: String(exception),
      });
    }
  }
}

/**
 * Utility functions for error handling
 */
export const ErrorFilterUtils = {
  /**
   * Check if an error is a client error (4xx)
   */
  isClientError: (statusCode: number): boolean => {
    return statusCode >= 400 && statusCode < 500;
  },

  /**
   * Check if an error is a server error (5xx)
   */
  isServerError: (statusCode: number): boolean => {
    return statusCode >= 500;
  },

  /**
   * Extract meaningful error message from exception
   */
  extractMessage: (exception: unknown): string => {
    if (exception instanceof Error) {
      return exception.message;
    }

    if (typeof exception === 'string') {
      return exception;
    }

    if (exception && typeof exception === 'object' && 'message' in exception) {
      return String((exception as { message: unknown }).message);
    }

    return 'Unknown error';
  },

  /**
   * Check if exception should be logged as error vs warning
   */
  shouldLogAsError: (exception: unknown): boolean => {
    if (exception instanceof HttpException) {
      return exception.getStatus() >= 500;
    }

    // Validation errors are client errors (handled by ZodErrorHandler)
    // Unknown exceptions are server errors
    return !(exception instanceof Error && exception.message.toLowerCase().includes('validation'));
  },
};
