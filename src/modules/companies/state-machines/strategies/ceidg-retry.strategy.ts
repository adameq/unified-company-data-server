import { Injectable } from '@nestjs/common';
import { RetryStrategy } from '../retry-strategy.interface';

/**
 * CEIDG Retry Strategy
 *
 * Implements retry logic specific to Polish CEIDG (Central Registration and
 * Information on Business) v3 REST API.
 *
 * Retryable errors:
 * - 5xx Server Errors (500, 502, 503, etc.)
 *
 * Non-retryable errors:
 * - 404 Not Found (individual entrepreneur not found in registry)
 * - 400 Bad Request (invalid NIP format, invalid query parameters)
 * - 401 Unauthorized (invalid JWT token)
 * - 429 Too Many Requests (rate limit exceeded)
 * - All 4xx Client Errors
 *
 * CEIDG-specific behavior:
 * CEIDG v3 API uses JWT authentication and has strict rate limiting
 * (1000 requests per hour). Only server errors (5xx) are transient
 * and should be retried.
 *
 * Rate limiting (429) is NOT retryable because:
 * - It requires waiting for quota reset (1 hour)
 * - Retrying immediately would fail again
 * - Application should handle rate limits at a higher level
 *
 * Note: If CEIDG fails, orchestration layer falls back to GUS detailed data.
 */
@Injectable()
export class CeidgRetryStrategy implements RetryStrategy {
  readonly name = 'CEIDG';

  canRetry(error: any): boolean {
    // Extract error code and status from various error formats
    const errorCode = error?.code || error?.errorCode;
    const statusCode = error?.status || error?.statusCode;

    // Universal non-retryable errors (fast fail)
    if (this.isNonRetryableClientError(statusCode, errorCode)) {
      return false;
    }

    // CEIDG-specific: Only retry 5xx server errors
    return statusCode >= 500;
  }

  /**
   * Check if error is a non-retryable client error
   *
   * Client errors indicate problems with the request itself (not transient failures):
   * - 404: Entity doesn't exist in registry (triggers GUS fallback, not retry)
   * - 400: Invalid request format (bad NIP, invalid parameters)
   * - 401: Authentication failure (invalid JWT)
   * - 429: Rate limit exceeded (requires quota reset)
   * - Other 4xx: Client-side issues
   */
  private isNonRetryableClientError(statusCode: number, errorCode: string): boolean {
    return (
      statusCode === 404 ||
      errorCode === 'ENTITY_NOT_FOUND' ||
      (statusCode >= 400 && statusCode < 500)
    );
  }
}
