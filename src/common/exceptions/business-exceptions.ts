import { HttpException } from '@nestjs/common';
import {
  type ErrorResponse,
  type ErrorCode,
  getHttpStatusForErrorCode,
} from '../../schemas/error-response.schema';

/**
 * Business Exception
 *
 * Custom exception class for business logic errors that extends HttpException.
 * Preserves stack trace and stores structured error information as properties.
 *
 * Benefits over `throw new Error(JSON.stringify(...))`:
 * - ✅ Stack trace preserved
 * - ✅ TypeScript typing maintained
 * - ✅ No JSON parsing needed
 * - ✅ Direct property access (errorCode, correlationId, source, details)
 * - ✅ Compatible with NestJS exception filters
 *
 * Usage:
 * ```typescript
 * throw new BusinessException({
 *   errorCode: 'ENTITY_NOT_FOUND',
 *   message: 'Company not found',
 *   correlationId: 'req-123',
 *   source: 'GUS',
 *   details: { nip: '1234567890' }
 * });
 * ```
 */
export class BusinessException extends HttpException {
  public readonly errorCode: ErrorCode;
  public readonly correlationId: string;
  public readonly source: 'GUS' | 'KRS' | 'CEIDG' | 'INTERNAL';
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(errorResponse: Omit<ErrorResponse, 'timestamp'> & { timestamp?: string }) {
    // Map errorCode to appropriate HTTP status using centralized mapping
    const statusCode = getHttpStatusForErrorCode(errorResponse.errorCode as ErrorCode);

    // Call parent constructor with message and status
    super(errorResponse.message, statusCode);

    // Store all error properties
    this.errorCode = errorResponse.errorCode as ErrorCode;
    this.correlationId = errorResponse.correlationId;
    this.source = errorResponse.source as 'GUS' | 'KRS' | 'CEIDG' | 'INTERNAL';
    this.details = errorResponse.details;
    this.timestamp = errorResponse.timestamp || new Date().toISOString();

    // Preserve error name
    this.name = 'BusinessException';

    // Preserve stack trace (important for debugging)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert back to ErrorResponse format for API responses
   */
  toErrorResponse(): ErrorResponse {
    return {
      errorCode: this.errorCode,
      message: this.message,
      correlationId: this.correlationId,
      source: this.source,
      timestamp: this.timestamp,
      details: this.details,
    };
  }
}