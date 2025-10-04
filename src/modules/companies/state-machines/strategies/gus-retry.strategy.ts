import { RetryStrategy } from '../retry-strategy.interface';

/**
 * GUS Retry Strategy
 *
 * Implements retry logic specific to Polish Statistical Office (GUS) SOAP API.
 *
 * Retryable errors:
 * - 5xx Server Errors (500, 502, 503, etc.)
 * - Session errors (SESSION_EXPIRED, SESSION_ERROR, GUS_SESSION_ERROR)
 * - Transient connection errors (GUS_CONNECTION_ERROR - network issues)
 *
 * Non-retryable errors:
 * - 404 Not Found (entity doesn't exist in registry)
 * - 400 Bad Request (invalid NIP format, invalid parameters)
 * - 401 Unauthorized (invalid API key)
 * - All 4xx Client Errors
 * - GUS_WSDL_PARSE_ERROR (WSDL parsing failure - not transient)
 * - GUS_AUTHENTICATION_FAILED (invalid credentials - not transient)
 *
 * GUS-specific behavior:
 * GUS API uses SOAP sessions that can expire during long operations.
 * When a session expires, the API returns SESSION_EXPIRED error.
 * This is a transient error that should be retried after creating a new session.
 *
 * Session management is handled by GusSessionManager, which automatically
 * refreshes sessions before retry attempts.
 */
export class GusRetryStrategy implements RetryStrategy {
  readonly name = 'GUS';

  canRetry(error: any): boolean {
    // Extract error code and status from various error formats
    const errorCode = error?.code || error?.errorCode;
    const statusCode = error?.status || error?.statusCode;

    // Universal non-retryable errors (fast fail)
    if (this.isNonRetryableClientError(statusCode, errorCode)) {
      return false;
    }

    // GUS-specific: Retry on 5xx, session errors, and transient connection errors
    return (
      statusCode >= 500 ||
      errorCode === 'SESSION_EXPIRED' ||
      errorCode === 'SESSION_ERROR' ||
      errorCode === 'GUS_SESSION_ERROR' ||
      errorCode === 'GUS_CONNECTION_ERROR' // Network issues are transient
    );
  }

  /**
   * Check if error is a non-retryable client error
   *
   * Client errors indicate problems with the request itself (not transient failures):
   * - 404: Entity doesn't exist in registry (negative data)
   * - 400: Invalid request format (bad NIP, invalid parameters)
   * - 401: Authentication failure (invalid API key)
   * - Other 4xx: Client-side issues
   * - GUS_WSDL_PARSE_ERROR: WSDL parsing failure (configuration issue)
   * - GUS_AUTHENTICATION_FAILED: Invalid credentials (not transient)
   */
  private isNonRetryableClientError(statusCode: number, errorCode: string): boolean {
    return (
      statusCode === 404 ||
      errorCode === 'ENTITY_NOT_FOUND' ||
      errorCode === 'GUS_WSDL_PARSE_ERROR' ||
      errorCode === 'GUS_AUTHENTICATION_FAILED' ||
      (statusCode >= 400 && statusCode < 500)
    );
  }
}
