import axios, { AxiosError } from 'axios';

/**
 * Type-safe error detection utilities
 *
 * These utilities replace brittle string-based error detection with
 * structured property checks that are resilient to library updates.
 *
 * Problem:
 * - String parsing (`message.includes('timeout')`) is fragile
 * - Error messages can change between library versions
 * - Localization can break string matching
 * - False positives from partial matches
 *
 * Solution:
 * - Use error codes (`error.code === 'ECONNABORTED'`)
 * - Check HTTP status codes (`error.response?.status === 404`)
 * - Use type guards (`instanceof`, `'property' in object`)
 * - Structured error object inspection
 *
 * Benefits:
 * - Resilient to library updates
 * - Better performance (property check vs string search)
 * - Type-safe with TypeScript
 * - Self-documenting error handling logic
 */

// ============================================================================
// AXIOS ERRORS
// ============================================================================

/**
 * Check if error is an AxiosError
 * Uses axios.isAxiosError() for reliable detection
 */
export function isAxiosError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error);
}

/**
 * Check if error is an Axios timeout error
 *
 * Axios uses ECONNABORTED for timeout errors.
 * With `transitional.clarifyTimeoutError: true`, timeouts get ETIMEDOUT.
 *
 * @see https://github.com/axios/axios/issues/1543
 */
export function isAxiosTimeoutError(error: unknown): error is AxiosError {
  return (
    isAxiosError(error) &&
    (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
  );
}

/**
 * Check if error is an Axios network error
 *
 * Network errors include:
 * - ECONNREFUSED: Connection refused (server not running)
 * - ENOTFOUND: DNS lookup failed (invalid hostname)
 * - ECONNRESET: Connection reset by peer (server crashed)
 */
export function isAxiosNetworkError(error: unknown): error is AxiosError {
  return (
    isAxiosError(error) &&
    (error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET')
  );
}

/**
 * Get HTTP status code from Axios error
 * Returns undefined if not an Axios error or no response
 */
export function getAxiosStatusCode(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined;
}

/**
 * Check if Axios error has specific HTTP status code
 */
export function hasAxiosStatus(
  error: unknown,
  statusCode: number,
): error is AxiosError {
  return getAxiosStatusCode(error) === statusCode;
}

// ============================================================================
// NODE.JS ERRORS
// ============================================================================

/**
 * Node.js Error with code property
 * System errors (network, file system) have error.code
 */
export interface NodeError extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

/**
 * Check if error is a Node.js system error with code property
 */
export function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}

/**
 * Check if error is a timeout error (universal)
 *
 * Checks both Axios and Node.js timeout errors.
 * Use this for generic timeout detection across all error sources.
 */
export function isTimeoutError(error: unknown): boolean {
  // Check axios timeout
  if (isAxiosTimeoutError(error)) return true;

  // Check Node.js timeout
  if (isNodeError(error) && error.code === 'ETIMEDOUT') return true;

  return false;
}

/**
 * Check if error is a network error (universal)
 *
 * Checks both Axios and Node.js network errors.
 * Use this for generic network error detection across all error sources.
 */
export function isNetworkError(error: unknown): boolean {
  // Check axios network errors
  if (isAxiosNetworkError(error)) return true;

  // Check Node.js network errors
  if (
    isNodeError(error) &&
    (error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET')
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// SOAP ERRORS (strong-soap)
// ============================================================================

/**
 * SOAP Fault structure (from strong-soap)
 *
 * strong-soap parses SOAP faults into structured objects.
 * The fault property contains parsed XML fault data.
 *
 * @see https://github.com/loopbackio/strong-soap
 */
export interface SoapFault {
  fault: {
    faultcode: string; // SOAP fault code (e.g., "soap:Server")
    faultstring: string; // Human-readable error message
    detail?: unknown; // Service-specific error details
  };
}

/**
 * Check if error is a SOAP fault (strong-soap)
 *
 * strong-soap attaches the fault object to errors from SOAP operations.
 * This allows structured error handling without string parsing.
 */
export function isSoapFault(error: unknown): error is SoapFault {
  return (
    typeof error === 'object' &&
    error !== null &&
    'fault' in error &&
    typeof (error as any).fault === 'object' &&
    (error as any).fault !== null &&
    'faultcode' in (error as any).fault &&
    'faultstring' in (error as any).fault
  );
}

/**
 * Get SOAP fault code from error
 * Returns undefined if not a SOAP fault
 */
export function getSoapFaultCode(error: unknown): string | undefined {
  return isSoapFault(error) ? error.fault.faultcode : undefined;
}

/**
 * Get SOAP fault string (error message) from error
 * Returns undefined if not a SOAP fault
 */
export function getSoapFaultString(error: unknown): string | undefined {
  return isSoapFault(error) ? error.fault.faultstring : undefined;
}

// ============================================================================
// GUS-SPECIFIC SOAP ERRORS
// ============================================================================

/**
 * GUS API error detail structure (Polish Statistical Office)
 *
 * NOTE: This structure is based on observed GUS API responses.
 * GUS API may return error codes in different formats:
 * 1. Structured XML: <KomunikatKod>2</KomunikatKod>
 * 2. In fault string: "Sesja wygasła (kod=2)"
 *
 * TODO: Verify actual structure with real GUS API errors
 * Add debug logging to capture full error.fault.detail structure
 */
export interface GusErrorDetail {
  KomunikatKod?: string; // Error code (e.g., "2" for session expired)
  KomunikatTresc?: string; // Error message in Polish
}

/**
 * Get GUS error code from SOAP fault
 *
 * Tries multiple detection strategies:
 * 1. Structured detail object (preferred)
 * 2. Regex parsing from faultstring (fallback)
 *
 * Returns undefined if no error code found.
 *
 * Common GUS error codes:
 * - "1": General error (Błąd ogólny)
 * - "2": Session expired or missing (Sesja wygasła)
 * - "7": Invalid session ID (Nieprawidłowy identyfikator sesji)
 */
export function getGusErrorCode(error: unknown): string | undefined {
  if (!isSoapFault(error)) return undefined;

  // Strategy 1: Check structured detail object
  const detail = error.fault.detail as GusErrorDetail | undefined;
  if (detail?.KomunikatKod) {
    return detail.KomunikatKod;
  }

  // Strategy 2: Fallback - parse from faultstring
  // GUS API sometimes embeds error code in message: "... (kod=2)"
  // This is a GUS API limitation - they don't always provide structured errors
  const faultString = error.fault.faultstring;
  if (typeof faultString === 'string') {
    const match = faultString.match(/kod[=\s]+(\d+)/i);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Check if error is GUS session expired error
 *
 * GUS error codes 2 and 7 indicate session problems:
 * - kod=2: Session expired or missing
 * - kod=7: Invalid session ID
 */
export function isGusSessionExpiredError(error: unknown): boolean {
  const errorCode = getGusErrorCode(error);
  return errorCode === '2' || errorCode === '7';
}

/**
 * Check if error is GUS deserialization error
 *
 * These errors occur when GUS API rejects malformed XML requests.
 * strong-soap may throw these when XML structure is invalid.
 */
export function isGusDeserializationError(error: unknown): boolean {
  if (!isSoapFault(error)) return false;

  const faultString = error.fault.faultstring?.toLowerCase() || '';
  return (
    faultString.includes('deserializationfailed') ||
    faultString.includes('error in line') ||
    faultString.includes('expecting state')
  );
}

// ============================================================================
// HTTP STATUS HELPERS
// ============================================================================

/**
 * Check if error has specific HTTP status code (works with any error type)
 *
 * Checks:
 * - Axios errors: error.response?.status
 * - HTTP exceptions: error.status or error.statusCode
 * - Generic objects with status property
 */
export function hasHttpStatus(error: unknown, statusCode: number): boolean {
  // Axios errors
  if (hasAxiosStatus(error, statusCode)) return true;

  // Generic HTTP error objects
  if (
    typeof error === 'object' &&
    error !== null &&
    ('status' in error || 'statusCode' in error)
  ) {
    const status =
      (error as any).status || (error as any).statusCode;
    return status === statusCode;
  }

  return false;
}

/**
 * Check if error is 4xx client error
 */
export function isClientError(error: unknown): boolean {
  const status = getAxiosStatusCode(error);
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Check if error is 5xx server error
 */
export function isServerError(error: unknown): boolean {
  const status = getAxiosStatusCode(error);
  return status !== undefined && status >= 500 && status < 600;
}

/**
 * Check if error should be retried based on HTTP status
 *
 * Retryable errors:
 * - 500 Internal Server Error
 * - 502 Bad Gateway
 * - 503 Service Unavailable
 * - 504 Gateway Timeout
 *
 * Non-retryable errors:
 * - 4xx client errors (bad request, auth, not found, etc.)
 * - 429 rate limit (needs backoff, not immediate retry)
 */
export function isRetryableHttpError(error: unknown): boolean {
  const status = getAxiosStatusCode(error);
  if (!status) return false;

  return status === 500 || status === 502 || status === 503 || status === 504;
}
