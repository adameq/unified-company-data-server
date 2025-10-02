import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  createErrorResponse,
  getHttpStatusForErrorCode,
  type ErrorResponse,
  type ErrorCode,
  ERROR_CODES,
} from '../../../schemas/error-response.schema';
import { BusinessException } from '../../../common/exceptions/business-exceptions';
import { ValidationException } from '../../../common/exceptions/validation.exception';
import {
  extractFromRequest,
  generateCorrelationId,
} from '../utils/correlation-id.utils';

/**
 * Global Exception Filter
 *
 * Catches all unhandled exceptions and converts them to standardized error responses.
 * Ensures consistent error format across the entire application.
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

    // Log the exception
    this.logException(exception, request, correlationId);

    // Convert exception to standardized error response
    const errorResponse = this.createStandardizedError(
      exception,
      correlationId,
    );
    const statusCode = this.getStatusCode(exception, errorResponse);

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
    } else if (exception instanceof ZodError) {
      this.logger.warn('Validation Error', {
        ...logContext,
        validationErrors: exception.issues,
      });
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

  /**
   * Convert any exception to standardized error response
   */
  private createStandardizedError(
    exception: unknown,
    correlationId: string,
  ): ErrorResponse {
    // Handle BusinessException (highest priority - preserves all error metadata)
    if (exception instanceof BusinessException) {
      return exception.toErrorResponse();
    }

    // Handle ValidationException (from ValidationPipe)
    // This provides type-safe, structured validation error handling
    if (exception instanceof ValidationException) {
      return exception.toErrorResponse(correlationId);
    }

    // Handle HttpException (includes NestJS built-in exceptions)
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      // If response is already an ErrorResponse, return it
      if (typeof response === 'object' && response && 'errorCode' in response) {
        return response as ErrorResponse;
      }

      // Convert HttpException to ErrorResponse
      return this.httpExceptionToErrorResponse(exception, correlationId);
    }

    // Handle Zod validation errors
    if (exception instanceof ZodError) {
      return this.zodErrorToErrorResponse(exception, correlationId);
    }

    // Handle standard JavaScript errors
    if (exception instanceof Error) {
      return this.standardErrorToErrorResponse(exception, correlationId);
    }

    // Handle unknown exceptions
    return createErrorResponse({
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
      source: 'INTERNAL',
      details: {
        exception: String(exception),
      },
    });
  }

  /**
   * Convert HttpException to ErrorResponse
   *
   * Note: ValidationPipe errors are now handled by ValidationException
   * This method only handles other HttpException instances
   */
  private httpExceptionToErrorResponse(
    exception: HttpException,
    correlationId: string,
  ): ErrorResponse {
    const status = exception.getStatus();
    const message = exception.message;

    // Map common HTTP status codes to error codes
    const errorCodeMap: Record<number, ErrorCode> = {
      400: ERROR_CODES.INVALID_REQUEST_FORMAT,
      401: ERROR_CODES.INVALID_API_KEY,
      403: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      404: ERROR_CODES.ENTITY_NOT_FOUND,
      408: ERROR_CODES.TIMEOUT_ERROR,
      422: ERROR_CODES.DATA_MAPPING_FAILED,
      429: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      500: ERROR_CODES.INTERNAL_SERVER_ERROR,
      502: ERROR_CODES.NETWORK_ERROR,
      503: ERROR_CODES.SERVICE_DEGRADED,
    };

    const errorCode =
      errorCodeMap[status] || ERROR_CODES.INTERNAL_SERVER_ERROR;

    return createErrorResponse({
      errorCode,
      message: message || `HTTP ${status} error`,
      correlationId,
      source: 'INTERNAL',
      details: {
        httpStatus: status,
        originalMessage: message,
      },
    });
  }

  /**
   * Convert ZodError to ErrorResponse
   */
  private zodErrorToErrorResponse(
    exception: ZodError,
    correlationId: string,
  ): ErrorResponse {
    // Check if this is a NIP validation error
    const nipError = exception.issues.find(
      (issue) =>
        issue.path.includes('nip') ||
        issue.message.toLowerCase().includes('nip'),
    );

    const errorCode = nipError
      ? 'INVALID_NIP_FORMAT'
      : 'INVALID_REQUEST_FORMAT';
    const message = nipError
      ? 'Invalid NIP format. Expected 10 digits.'
      : 'Request validation failed';

    return createErrorResponse({
      errorCode,
      message,
      correlationId,
      source: 'INTERNAL',
      details: {
        validationErrors: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      },
    });
  }

  /**
   * Convert standard Error to ErrorResponse
   */
  private standardErrorToErrorResponse(
    exception: Error,
    correlationId: string,
  ): ErrorResponse {
    // Check for specific error types
    if (exception.message.toLowerCase().includes('timeout')) {
      return createErrorResponse({
        errorCode: 'TIMEOUT_ERROR',
        message: 'Operation timed out',
        correlationId,
        source: 'INTERNAL',
        details: {
          originalMessage: exception.message,
        },
      });
    }

    if (
      exception.message.toLowerCase().includes('network') ||
      exception.message.toLowerCase().includes('connection')
    ) {
      return createErrorResponse({
        errorCode: 'NETWORK_ERROR',
        message: 'Network connection error',
        correlationId,
        source: 'INTERNAL',
        details: {
          originalMessage: exception.message,
        },
      });
    }

    // Generic error
    return createErrorResponse({
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'An internal server error occurred',
      correlationId,
      source: 'INTERNAL',
      details: {
        originalMessage: exception.message,
        errorName: exception.constructor.name,
      },
    });
  }

  /**
   * Get HTTP status code for the response
   */
  private getStatusCode(
    exception: unknown,
    errorResponse: ErrorResponse,
  ): number {
    // If it's an HttpException, use its status
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    // If it's a validation error, return 400
    if (exception instanceof ZodError) {
      return HttpStatus.BAD_REQUEST;
    }

    // Use error code mapping
    return getHttpStatusForErrorCode(errorResponse.errorCode as ErrorCode);
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

    if (exception instanceof ZodError) {
      return false; // Validation errors are client errors
    }

    return true; // Unknown exceptions are server errors
  },
};
