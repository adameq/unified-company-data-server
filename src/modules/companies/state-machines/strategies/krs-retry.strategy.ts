import { RetryStrategy } from '../retry-strategy.interface';

/**
 * KRS Retry Strategy
 *
 * Implements retry logic specific to Polish National Court Register (KRS) REST API.
 *
 * Retryable errors:
 * - 5xx Server Errors (500, 502, 503, etc.)
 *
 * Non-retryable errors:
 * - 404 Not Found (entity doesn't exist in registry P or S)
 * - 400 Bad Request (invalid KRS number format)
 * - 401 Unauthorized (API authentication failure)
 * - All 4xx Client Errors
 *
 * KRS-specific behavior:
 * KRS API is a simple REST API without session management.
 * Only server errors (5xx) are considered transient and retryable.
 * 404 errors are treated as negative data (entity not found) and trigger
 * registry fallback logic (P → S) at the orchestration layer, not retry layer.
 *
 * Note: Registry fallback (P → S) is business logic in orchestration.machine.ts,
 * not retry logic. A 404 from registry P will NOT be retried - instead,
 * orchestration will try registry S.
 */
export class KrsRetryStrategy implements RetryStrategy {
  readonly name = 'KRS';

  canRetry(error: any): boolean {
    // Extract error code and status from various error formats
    const errorCode = error?.code || error?.errorCode;
    const statusCode = error?.status || error?.statusCode;

    // Universal non-retryable errors (fast fail)
    if (this.isNonRetryableClientError(statusCode, errorCode)) {
      return false;
    }

    // KRS-specific: Only retry 5xx server errors
    return statusCode >= 500;
  }

  /**
   * Check if error is a non-retryable client error
   *
   * Client errors indicate problems with the request itself (not transient failures):
   * - 404: Entity doesn't exist in current registry (triggers P→S fallback, not retry)
   * - 400: Invalid request format (bad KRS number)
   * - 401: Authentication failure
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
