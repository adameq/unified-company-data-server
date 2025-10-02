import { HttpException, HttpStatus } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import type {
  ErrorResponse,
  ErrorCode,
} from '../../schemas/error-response.schema';
import { createErrorResponse } from '../../schemas/error-response.schema';

/**
 * Validation Exception
 *
 * Custom exception class for input validation errors from ValidationPipe.
 * Converts class-validator ValidationError[] to structured ErrorResponse format.
 *
 * Benefits:
 * - ✅ Type-safe error structure (no type casting needed)
 * - ✅ Automatic error code determination (INVALID_NIP_FORMAT vs MISSING_REQUIRED_FIELDS)
 * - ✅ User-friendly messages
 * - ✅ Consistent with BusinessException pattern
 * - ✅ Simplifies GlobalExceptionFilter logic
 *
 * Usage (in ValidationPipe exceptionFactory):
 * ```typescript
 * exceptionFactory: (errors) => {
 *   return new ValidationException(errors);
 * }
 * ```
 */
export class ValidationException extends HttpException {
  public readonly errorCode: ErrorCode;
  public readonly validationErrors: ValidationError[];
  public readonly userMessage: string;
  private readonly correlationIdFallback: string;

  constructor(errors: ValidationError[], correlationId?: string) {
    // Analyze errors to determine appropriate error code
    const errorCode = determineErrorCode(errors);

    // Create user-friendly message based on error type
    const userMessage = createUserFriendlyMessage(errorCode, errors);

    // Call parent constructor with message and status
    super(userMessage, HttpStatus.BAD_REQUEST);

    // Store structured error information
    this.errorCode = errorCode;
    this.validationErrors = errors;
    this.userMessage = userMessage;
    this.correlationIdFallback =
      correlationId || `validation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Preserve error name
    this.name = 'ValidationException';

    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to ErrorResponse format for API responses
   * Uses correlationId from request if available, otherwise uses fallback
   */
  toErrorResponse(correlationId?: string): ErrorResponse {
    return createErrorResponse({
      errorCode: this.errorCode,
      message: this.userMessage,
      correlationId: correlationId || this.correlationIdFallback,
      source: 'INTERNAL',
      details: {
        validationErrors: this.validationErrors.map((error) =>
          Object.values(error.constraints || {}).join(', '),
        ),
      },
    });
  }
}

/**
 * Analyze ValidationError[] to determine appropriate ErrorCode
 */
function determineErrorCode(errors: ValidationError[]): ErrorCode {
  // Check if any error is related to 'nip' field
  const hasNipError = errors.some(
    (error) => error.property === 'nip' && error.constraints !== undefined,
  );

  if (hasNipError) {
    return 'INVALID_NIP_FORMAT';
  }

  // Check if any error is a missing field error
  const hasMissingField = errors.some((error) => {
    if (!error.constraints) return false;
    const constraintKeys = Object.keys(error.constraints);
    return (
      constraintKeys.includes('isNotEmpty') ||
      constraintKeys.includes('isDefined') ||
      constraintKeys.includes('isString')
    );
  });

  if (hasMissingField) {
    return 'MISSING_REQUIRED_FIELDS';
  }

  // Default for other validation errors
  return 'INVALID_REQUEST_FORMAT';
}

/**
 * Create user-friendly message based on error code and validation errors
 */
function createUserFriendlyMessage(
  errorCode: ErrorCode,
  errors: ValidationError[],
): string {
  switch (errorCode) {
    case 'INVALID_NIP_FORMAT':
      return 'Invalid NIP format. Expected exactly 10 digits.';

    case 'MISSING_REQUIRED_FIELDS':
      return 'Required fields are missing from the request.';

    case 'INVALID_REQUEST_FORMAT':
      // List specific fields with errors
      const fields = errors.map((e) => e.property).join(', ');
      return `Invalid request format. Check fields: ${fields}`;

    default:
      return 'Validation failed.';
  }
}
