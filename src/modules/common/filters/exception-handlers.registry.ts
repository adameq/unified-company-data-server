import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import {
  createErrorResponse,
  type ErrorResponse,
  type ErrorCode,
  ERROR_CODES,
} from '@schemas/error-response.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import { ValidationException } from '../exceptions/validation.exception';

/**
 * Exception Handler Strategy Pattern
 *
 * Each handler is responsible for:
 * 1. Detecting if it can handle an exception (canHandle)
 * 2. Converting the exception to ErrorResponse (handle)
 *
 * Handlers are executed in priority order (lowest number = highest priority)
 */

export interface ExceptionHandler {
  /** Check if this handler can process the exception */
  canHandle(exception: unknown): boolean;

  /** Convert exception to standardized ErrorResponse */
  handle(exception: unknown, correlationId: string): ErrorResponse;

  /** Execution priority (lower = higher priority) */
  priority: number;

  /** Handler name for debugging */
  name: string;
}

/**
 * Handler for BusinessException (highest priority)
 * BusinessException already contains structured error data
 */
export class BusinessExceptionHandler implements ExceptionHandler {
  priority = 1;
  name = 'BusinessExceptionHandler';

  canHandle(exception: unknown): boolean {
    return exception instanceof BusinessException;
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    return (exception as BusinessException).toErrorResponse();
  }
}

/**
 * Handler for ValidationException (structured validation errors)
 * Replaces string-based ValidationPipeErrorHandler with constraint-based mapping
 */
export class ValidationExceptionHandler implements ExceptionHandler {
  priority = 2;
  name = 'ValidationExceptionHandler';

  canHandle(exception: unknown): boolean {
    return exception instanceof ValidationException;
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    const validationException = exception as ValidationException;
    return validationException.toErrorResponse(correlationId);
  }
}

/**
 * Handler for HttpException (NestJS built-in exceptions)
 * Includes UnauthorizedException, NotFoundException, etc.
 */
export class HttpExceptionHandler implements ExceptionHandler {
  priority = 3;
  name = 'HttpExceptionHandler';

  canHandle(exception: unknown): boolean {
    if (!(exception instanceof HttpException)) {
      return false;
    }

    // CRITICAL: Explicitly exclude specialized exception types
    // These exceptions extend HttpException but have dedicated handlers
    if (exception instanceof BusinessException) {
      return false;
    }

    if (exception instanceof ValidationException) {
      return false;
    }

    // Skip if already an ErrorResponse
    const response = exception.getResponse();
    if (typeof response === 'object' && response && 'errorCode' in response) {
      return false;
    }

    return true;
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    const httpException = exception as HttpException;
    const status = httpException.getStatus();
    const message = httpException.message;

    // Map HTTP status to ErrorCode
    const errorCode = this.statusToErrorCode(status);

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
   * Map HTTP status codes to ErrorCode
   * Declarative mapping - easy to extend
   */
  private statusToErrorCode(status: number): ErrorCode {
    const mapping: Record<number, ErrorCode> = {
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

    return mapping[status] || ERROR_CODES.INTERNAL_SERVER_ERROR;
  }
}

/**
 * Handler for Zod validation errors
 */
export class ZodErrorHandler implements ExceptionHandler {
  priority = 4;
  name = 'ZodErrorHandler';

  canHandle(exception: unknown): boolean {
    return exception instanceof ZodError;
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    const zodError = exception as ZodError;

    // Check if this is a NIP validation error
    const nipError = zodError.issues.find(
      (issue) =>
        issue.path.includes('nip') ||
        issue.message.toLowerCase().includes('nip'),
    );

    const errorCode = nipError
      ? ERROR_CODES.INVALID_NIP_FORMAT
      : ERROR_CODES.INVALID_REQUEST_FORMAT;

    const message = nipError
      ? 'Invalid NIP format. Expected 10 digits.'
      : 'Request validation failed';

    return createErrorResponse({
      errorCode,
      message,
      correlationId,
      source: 'INTERNAL',
      details: {
        validationErrors: zodError.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      },
    });
  }
}

/**
 * Handler for timeout errors (Error with "timeout" in message)
 */
export class TimeoutErrorHandler implements ExceptionHandler {
  priority = 5;
  name = 'TimeoutErrorHandler';

  canHandle(exception: unknown): boolean {
    return (
      exception instanceof Error &&
      exception.message.toLowerCase().includes('timeout')
    );
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    const error = exception as Error;

    return createErrorResponse({
      errorCode: ERROR_CODES.TIMEOUT_ERROR,
      message: 'Operation timed out',
      correlationId,
      source: 'INTERNAL',
      details: {
        originalMessage: error.message,
      },
    });
  }
}

/**
 * Handler for network errors (Error with "network" or "connection" in message)
 */
export class NetworkErrorHandler implements ExceptionHandler {
  priority = 6;
  name = 'NetworkErrorHandler';

  canHandle(exception: unknown): boolean {
    if (!(exception instanceof Error)) {
      return false;
    }

    const msg = exception.message.toLowerCase();
    return msg.includes('network') || msg.includes('connection');
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    const error = exception as Error;

    return createErrorResponse({
      errorCode: ERROR_CODES.NETWORK_ERROR,
      message: 'Network connection error',
      correlationId,
      source: 'INTERNAL',
      details: {
        originalMessage: error.message,
      },
    });
  }
}

/**
 * Handler for standard JavaScript Error objects
 */
export class StandardErrorHandler implements ExceptionHandler {
  priority = 7;
  name = 'StandardErrorHandler';

  canHandle(exception: unknown): boolean {
    return exception instanceof Error;
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    const error = exception as Error;

    return createErrorResponse({
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'An internal server error occurred',
      correlationId,
      source: 'INTERNAL',
      details: {
        originalMessage: error.message,
        errorName: error.constructor.name,
      },
    });
  }
}

/**
 * Fallback handler for unknown exceptions
 * Always handles any exception (lowest priority)
 */
export class UnknownExceptionHandler implements ExceptionHandler {
  priority = 99;
  name = 'UnknownExceptionHandler';

  canHandle(exception: unknown): boolean {
    return true; // Handles everything
  }

  handle(exception: unknown, correlationId: string): ErrorResponse {
    return createErrorResponse({
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
      correlationId,
      source: 'INTERNAL',
      details: {
        exception: String(exception),
      },
    });
  }
}

/**
 * Exception Handler Registry
 *
 * Central registry for all exception handlers.
 * Handlers are sorted by priority (lowest number first).
 */
export class ExceptionHandlerRegistry {
  private static handlers: ExceptionHandler[] = [
    new BusinessExceptionHandler(),
    new ValidationExceptionHandler(),
    new HttpExceptionHandler(),
    new ZodErrorHandler(),
    new TimeoutErrorHandler(),
    new NetworkErrorHandler(),
    new StandardErrorHandler(),
    new UnknownExceptionHandler(),
  ];

  /**
   * Get all handlers sorted by priority
   */
  static getAll(): ExceptionHandler[] {
    return [...this.handlers].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Find the first handler that can process the exception
   */
  static findHandler(exception: unknown): ExceptionHandler {
    const handler = this.handlers.find((h) => h.canHandle(exception));

    // Fallback to UnknownExceptionHandler if no handler found
    return handler || new UnknownExceptionHandler();
  }

  /**
   * Register a custom handler (for testing or extension)
   */
  static register(handler: ExceptionHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Reset handlers to default (for testing)
   */
  static reset(): void {
    this.handlers = [
      new BusinessExceptionHandler(),
      new ValidationExceptionHandler(),
      new HttpExceptionHandler(),
      new ZodErrorHandler(),
      new TimeoutErrorHandler(),
      new NetworkErrorHandler(),
      new StandardErrorHandler(),
      new UnknownExceptionHandler(),
    ];
  }
}
