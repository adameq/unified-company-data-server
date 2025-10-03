import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getHttpStatusForErrorCode } from '@schemas/error-response.schema';
import { generateCorrelationId, extractFromRequest } from '../utils/correlation-id.utils';
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

    // Extract correlation ID from request (with body-parser exception handling)
    const correlationId = this.getCorrelationId(request, exception);

    // Log the exception with context
    this.logException(exception, request, correlationId);

    // Find appropriate handler and convert to ErrorResponse
    const handler = ExceptionHandlerRegistry.findHandler(exception);
    const errorResponse = handler.handle(exception, correlationId);

    // Map ErrorCode to HTTP status
    const statusCode = getHttpStatusForErrorCode(errorResponse.errorCode as any);

    // Send error response
    response.status(statusCode).json(errorResponse);
  }

  /**
   * Extract correlation ID from request
   * Fail-fast: throws error if ID is missing (indicates misconfiguration)
   * Exception: Body-parser errors (SyntaxError) occur before middleware runs - generate fallback
   *
   * Type-safe: Uses Express.Request extension from src/types/express.d.ts
   */
  private getCorrelationId(request: Request, exception: unknown): string {
    const id = extractFromRequest(request);

    if (!id) {
      // Body-parser errors (malformed JSON, etc.) occur BEFORE middleware runs
      // These are legitimate client errors (400), not configuration errors
      if (this.isBodyParserError(exception)) {
        const generatedId = generateCorrelationId();
        this.logger.warn(
          'Correlation ID missing due to body-parser error - generating fallback',
          {
            generatedId,
            path: request.path,
            method: request.method,
            errorType: exception instanceof Error ? exception.constructor.name : 'Unknown',
          },
        );
        return generatedId;
      }

      // Fail-fast: Middleware did not execute - critical configuration error
      this.logger.error(
        'CRITICAL: Correlation ID missing - CorrelationIdMiddleware not executed',
        {
          path: request.path,
          method: request.method,
          middlewareStatus: 'NOT_EXECUTED',
          possibleCauses: [
            'CommonModule not imported in AppModule',
            'Middleware registration failed',
            'Non-HTTP context (WebSocket/GraphQL - not supported)',
          ],
        },
      );

      throw new InternalServerErrorException(
        'Correlation ID middleware not executed - check application configuration',
      );
    }

    return id;
  }

  /**
   * Check if exception is a body-parser error (occurs before middleware)
   * Body-parser throws SyntaxError for malformed JSON
   * NestJS wraps it in BadRequestException
   */
  private isBodyParserError(exception: unknown): boolean {
    // Body-parser errors are wrapped in BadRequestException by NestJS
    if (exception instanceof HttpException && exception.getStatus() === 400) {
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : (response as any)?.message || '';
      const messageStr = Array.isArray(message) ? message.join(' ') : String(message);
      const messageLower = messageStr.toLowerCase();

      // Check for body-parser specific error patterns
      return (
        messageLower.includes('json') ||
        messageLower.includes('unexpected token') ||
        messageLower.includes('parse')
      );
    }

    // Also check for direct SyntaxError (pre-NestJS wrapping)
    if (exception instanceof SyntaxError) {
      const message = exception.message.toLowerCase();
      return (
        message.includes('json') ||
        message.includes('unexpected') ||
        message.includes('parse')
      );
    }

    return false;
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
