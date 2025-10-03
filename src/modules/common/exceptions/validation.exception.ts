import { HttpException, HttpStatus } from '@nestjs/common';
import {
  createErrorResponse,
  type ErrorResponse,
  type ErrorCode,
} from '@schemas/error-response.schema';

/**
 * Structured validation error details
 *
 * Extracted from class-validator ValidationError with structured metadata
 */
export interface ValidationErrorDetail {
  /** Property name that failed validation */
  property: string;

  /** Value that failed validation */
  value: any;

  /** Validation constraint that failed (e.g., 'matches', 'isNotEmpty') */
  constraint: string;

  /** Human-readable constraint message */
  message: string;
}

/**
 * ValidationException
 *
 * Structured exception for validation errors with precise error codes.
 * Replaces string-based parsing with constraint-based mapping.
 *
 * Benefits:
 * - No string parsing (robust against message changes)
 * - Precise error codes based on constraint types
 * - Structured validation error details
 * - Easy to test and extend
 *
 * Usage:
 * ```typescript
 * throw new ValidationException(
 *   'INVALID_NIP_FORMAT',
 *   'Invalid NIP format',
 *   [{ property: 'nip', value: '123', constraint: 'matches', message: '...' }]
 * );
 * ```
 */
export class ValidationException extends HttpException {
  constructor(
    public readonly errorCode: ErrorCode,
    message: string,
    public readonly validationErrors: ValidationErrorDetail[],
  ) {
    super(message, HttpStatus.BAD_REQUEST);
  }

  /**
   * Convert to standardized ErrorResponse
   */
  toErrorResponse(correlationId: string): ErrorResponse {
    return createErrorResponse({
      errorCode: this.errorCode,
      message: this.message,
      correlationId,
      source: 'INTERNAL',
      details: {
        validationErrors: this.validationErrors.map((err) => ({
          property: err.property,
          constraint: err.constraint,
          message: err.message,
        })),
      },
    });
  }
}
