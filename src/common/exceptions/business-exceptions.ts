import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorResponse, ErrorCode } from '../../schemas/error-response.schema';

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
    // Map errorCode to appropriate HTTP status
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

/**
 * Map error codes to HTTP status codes
 */
function getHttpStatusForErrorCode(errorCode: ErrorCode): number {
  // Input validation errors -> 400
  if (
    errorCode === 'INVALID_NIP_FORMAT' ||
    errorCode === 'INVALID_REQUEST_FORMAT' ||
    errorCode === 'MISSING_REQUIRED_FIELDS'
  ) {
    return HttpStatus.BAD_REQUEST;
  }

  // Authentication/authorization errors -> 401/403
  if (
    errorCode === 'INVALID_API_KEY' ||
    errorCode === 'MISSING_API_KEY' ||
    errorCode === 'API_KEY_EXPIRED'
  ) {
    return HttpStatus.UNAUTHORIZED;
  }
  if (errorCode === 'INSUFFICIENT_PERMISSIONS') {
    return HttpStatus.FORBIDDEN;
  }

  // Not found errors -> 404
  if (errorCode === 'ENTITY_NOT_FOUND' || errorCode === 'ENTITY_DEREGISTERED') {
    return HttpStatus.NOT_FOUND;
  }

  // Timeout errors -> 408
  if (errorCode === 'TIMEOUT_ERROR') {
    return HttpStatus.REQUEST_TIMEOUT;
  }

  // Rate limiting -> 429
  if (
    errorCode === 'RATE_LIMIT_EXCEEDED' ||
    errorCode === 'KRS_RATE_LIMIT' ||
    errorCode === 'CEIDG_RATE_LIMIT'
  ) {
    return HttpStatus.TOO_MANY_REQUESTS;
  }

  // Service unavailable errors -> 503
  if (
    errorCode === 'GUS_SERVICE_UNAVAILABLE' ||
    errorCode === 'KRS_SERVICE_UNAVAILABLE' ||
    errorCode === 'CEIDG_SERVICE_UNAVAILABLE' ||
    errorCode === 'SERVICE_DEGRADED' ||
    errorCode === 'CRITICAL_SERVICE_UNAVAILABLE'
  ) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }

  // Bad gateway errors -> 502
  if (errorCode === 'NETWORK_ERROR') {
    return HttpStatus.BAD_GATEWAY;
  }

  // All other errors -> 500
  return HttpStatus.INTERNAL_SERVER_ERROR;
}