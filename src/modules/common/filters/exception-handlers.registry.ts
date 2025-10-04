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
import { isTimeoutError, isNetworkError } from '@common/utils/error-detection.utils';

/**
 * Exception Handler Strategy Pattern
 *
 * Each handler is responsible for:
 * 1. Detecting if it can handle an exception (canHandle)
 * 2. Converting the exception to ErrorResponse (handle)
 *
 * Handler Selection Strategy:
 * - Handlers are executed in priority order (lowest number = highest priority)
 * - First matching handler wins (Array.find() behavior in findHandler())
 * - More specific handlers MUST have lower priority than generic handlers
 *
 * Priority Architecture (from highest to lowest):
 * - BusinessExceptionHandler (1) - catches BusinessException before HttpExceptionHandler
 * - ValidationExceptionHandler (2) - catches ValidationException before HttpExceptionHandler
 * - HttpExceptionHandler (3) - catches remaining HttpExceptions (UnauthorizedException, etc.)
 * - ZodErrorHandler (4) - catches Zod validation errors
 * - TimeoutErrorHandler (5) - catches timeout errors
 * - NetworkErrorHandler (6) - catches network errors
 * - StandardErrorHandler (7) - catches standard Error instances
 * - UnknownExceptionHandler (99) - fallback for all other exceptions
 *
 * Open/Closed Principle:
 * - New exception types can be added without modifying existing handlers
 * - Generic handlers (like HttpExceptionHandler) don't need to explicitly exclude specific types
 * - Priority ordering ensures correct handler selection
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

    // REMOVED: Explicit exclusions of BusinessException and ValidationException
    // These are now handled by priority ordering:
    // - BusinessExceptionHandler (priority 1) catches BusinessException before this handler
    // - ValidationExceptionHandler (priority 2) catches ValidationException before this handler
    // - HttpExceptionHandler (priority 3) catches remaining HttpExceptions
    // This eliminates tight coupling and follows Open/Closed Principle

    // Skip if already an ErrorResponse (avoid double-wrapping)
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
    // Use issue.path (controlled by our schemas) instead of message parsing
    const nipError = zodError.issues.find((issue) =>
      issue.path.includes('nip'),
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
 * Handler for timeout errors
 *
 * Refactored to use type-safe error detection.
 * Checks error.code (ECONNABORTED, ETIMEDOUT) instead of message parsing.
 */
export class TimeoutErrorHandler implements ExceptionHandler {
  priority = 5;
  name = 'TimeoutErrorHandler';

  canHandle(exception: unknown): boolean {
    return isTimeoutError(exception);
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
 * Handler for network errors
 *
 * Refactored to use type-safe error detection.
 * Checks error.code (ECONNREFUSED, ENOTFOUND, ECONNRESET) instead of message parsing.
 */
export class NetworkErrorHandler implements ExceptionHandler {
  priority = 6;
  name = 'NetworkErrorHandler';

  canHandle(exception: unknown): boolean {
    return isNetworkError(exception);
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
 *
 * IMPORTANT: Handler selection relies on priority ordering.
 * More specific handlers (BusinessException, ValidationException)
 * MUST have lower priority numbers than generic handlers (HttpException).
 *
 * Example:
 * - BusinessExceptionHandler (priority 1) catches BusinessException
 * - HttpExceptionHandler (priority 3) catches remaining HttpExceptions
 * - First matching handler wins (Array.find() behavior)
 *
 * Defensive Programming:
 * - validatePriorities() ensures correct priority configuration
 * - Throws error if specific handlers have higher priority than generic ones
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
   * Validate handler priorities (defensive programming)
   *
   * Ensures more specific handlers have lower priority than generic ones.
   * Throws error if configuration is incorrect.
   *
   * Rationale:
   * - BusinessExceptionHandler must catch BusinessException before HttpExceptionHandler
   * - ValidationExceptionHandler must catch ValidationException before HttpExceptionHandler
   * - Without this validation, incorrect priorities would cause subtle bugs
   */
  private static validatePriorities(): void {
    const businessHandler = this.handlers.find(
      (h) => h.name === 'BusinessExceptionHandler',
    );
    const validationHandler = this.handlers.find(
      (h) => h.name === 'ValidationExceptionHandler',
    );
    const httpHandler = this.handlers.find(
      (h) => h.name === 'HttpExceptionHandler',
    );

    if (
      businessHandler &&
      httpHandler &&
      businessHandler.priority >= httpHandler.priority
    ) {
      throw new Error(
        `Configuration error: BusinessExceptionHandler (priority ${businessHandler.priority}) ` +
          `must have lower priority than HttpExceptionHandler (priority ${httpHandler.priority})`,
      );
    }

    if (
      validationHandler &&
      httpHandler &&
      validationHandler.priority >= httpHandler.priority
    ) {
      throw new Error(
        `Configuration error: ValidationExceptionHandler (priority ${validationHandler.priority}) ` +
          `must have lower priority than HttpExceptionHandler (priority ${httpHandler.priority})`,
      );
    }
  }

  /**
   * Get all handlers sorted by priority
   *
   * Validates priorities before returning to catch configuration errors early.
   */
  static getAll(): ExceptionHandler[] {
    this.validatePriorities();
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
