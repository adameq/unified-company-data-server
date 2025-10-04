import { Injectable, Logger } from '@nestjs/common';
import {
  createErrorResponse,
  type ErrorResponse,
} from '@schemas/error-response.schema';
import type { GusApiError } from '../parsers/gus-response.parser';
import {
  isSoapFault,
  getGusErrorCode,
  isGusSessionExpiredError,
  isGusDeserializationError,
  isTimeoutError,
  isNetworkError,
  hasHttpStatus,
} from '@common/utils/error-detection.utils';

/**
 * GUS Error Handler
 *
 * Single Responsibility: Convert GUS errors to standardized ErrorResponse format
 *
 * Responsibilities:
 * - Handle SOAP faults and convert to ErrorResponse
 * - Handle GUS API errors (ErrorCode from XML) and convert to ErrorResponse
 * - Handle network/timeout errors and convert to ErrorResponse
 * - Map GUS error codes to application error codes
 * - Classify errors as session-related (caller must clear session)
 *
 * NOT responsible for:
 * - XML parsing (handled by GusResponseParser)
 * - Zod validation (handled by GusResponseValidator)
 * - Session creation (handled by GusSessionManager)
 * - Clearing session (delegated to caller - GusService)
 *
 * Design decision: No GusSessionManager dependency to avoid circular dependency
 * and keep error handler stateless. Session clearing is responsibility of caller.
 */

@Injectable()
export class GusErrorHandler {
  private readonly logger = new Logger(GusErrorHandler.name);

  /**
   * Handle GUS API error from parsed XML data
   *
   * Converts GUS error codes to application error codes:
   * - ErrorCode '4' → ENTITY_NOT_FOUND
   * - Other codes → GUS_SERVICE_UNAVAILABLE
   *
   * @param gusError - Error detected in parsed XML (from GusResponseParser)
   * @param correlationId - Request correlation ID
   * @param nip - NIP or REGON used in request (for error details)
   * @returns ErrorResponse formatted for API
   */
  handleGusApiError(
    gusError: GusApiError,
    correlationId: string,
    identifier: string,
  ): ErrorResponse {
    const { errorCode, errorMessage } = gusError;

    // Error code '4' means "not found" in GUS API
    if (errorCode === '4') {
      return createErrorResponse({
        errorCode: 'ENTITY_NOT_FOUND',
        message: `No entity found for identifier: ${identifier}`,
        correlationId,
        source: 'GUS',
        details: { gusErrorCode: errorCode, gusErrorMessage: errorMessage },
      });
    }

    // All other GUS error codes
    return createErrorResponse({
      errorCode: 'GUS_SERVICE_UNAVAILABLE',
      message: `GUS service error: ${errorMessage}`,
      correlationId,
      source: 'GUS',
      details: { gusErrorCode: errorCode, gusErrorMessage: errorMessage },
    });
  }

  /**
   * Handle generic SOAP/network errors from GUS operations
   *
   * Detects and categorizes:
   * - SOAP faults (faultstring)
   * - XML deserialization errors
   * - Session expiration (codes 1, 2, 7)
   * - HTTP 401 Unauthorized
   * - Timeout errors
   * - Network errors (ECONNREFUSED, ENOTFOUND)
   * - Generic session-related errors
   *
   * NOTE: This method does NOT clear session. Caller (GusService) is responsible
   * for clearing session when error code is GUS_SESSION_EXPIRED.
   *
   * @param error - Error object from SOAP operation
   * @param correlationId - Request correlation ID
   * @param operation - Operation name (for error details)
   * @returns ErrorResponse formatted for API
   */
  handleSoapError(
    error: any,
    correlationId: string,
    operation: string,
  ): ErrorResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 1. SOAP fault handling (type-safe check)
    if (isSoapFault(error)) {
      // Check for session expiration (type-safe via getGusErrorCode)
      if (isGusSessionExpiredError(error)) {
        const errorCode = getGusErrorCode(error);
        return createErrorResponse({
          errorCode: 'GUS_SESSION_EXPIRED',
          message: `GUS session has expired or is invalid (kod=${errorCode})`,
          correlationId,
          source: 'GUS',
          details: { operation, gusErrorCode: errorCode, fault: error.fault },
        });
      }

      // Check for deserialization errors (type-safe)
      if (isGusDeserializationError(error)) {
        return createErrorResponse({
          errorCode: 'GUS_SOAP_FAULT',
          message: 'GUS API rejected XML request due to formatting issues',
          correlationId,
          source: 'GUS',
          details: {
            operation,
            fault: error.fault,
            hint: 'Check XML element formatting and CDATA usage',
          },
        });
      }

      // Generic SOAP fault
      return createErrorResponse({
        errorCode: 'GUS_SOAP_FAULT',
        message: error.fault.faultstring || 'SOAP fault occurred',
        correlationId,
        source: 'GUS',
        details: {
          operation,
          faultcode: error.fault.faultcode,
          faultstring: error.fault.faultstring,
        },
      });
    }

    // 2. HTTP 401 Unauthorized (type-safe check)
    if (hasHttpStatus(error, 401)) {
      return createErrorResponse({
        errorCode: 'GUS_SESSION_EXPIRED',
        message: 'GUS session unauthorized (HTTP 401)',
        correlationId,
        source: 'GUS',
        details: { operation, httpStatus: 401 },
      });
    }

    // 3. Timeout errors (type-safe check)
    if (isTimeoutError(error)) {
      return createErrorResponse({
        errorCode: 'TIMEOUT_ERROR',
        message: `GUS ${operation} operation timed out`,
        correlationId,
        source: 'GUS',
        details: { operation, originalError: errorMessage },
      });
    }

    // 4. Network/connection errors (type-safe check)
    if (isNetworkError(error)) {
      const errorCode = (error as any).code;
      return createErrorResponse({
        errorCode: 'GUS_SERVICE_UNAVAILABLE',
        message: 'Cannot connect to GUS service',
        correlationId,
        source: 'GUS',
        details: {
          operation,
          errorCode,
          originalError: errorMessage,
        },
      });
    }

    // 5. Generic session expiration patterns (INTENTIONAL STRING PARSING - fallback)
    //
    // This is a last-resort fallback for session errors not caught by SOAP fault detection.
    // GUS API sometimes returns session errors in unexpected formats.
    // Primary detection happens via isSoapFault + getGusErrorCode (type-safe above).
    if (
      errorMessage.toLowerCase().includes('session') ||
      errorMessage.toLowerCase().includes('unauthorized') ||
      errorMessage.toLowerCase().includes('sid')
    ) {
      return createErrorResponse({
        errorCode: 'GUS_SESSION_EXPIRED',
        message: 'GUS session has expired',
        correlationId,
        source: 'GUS',
        details: { operation, originalError: errorMessage },
      });
    }

    // 6. Generic GUS service error (fallback)
    return createErrorResponse({
      errorCode: 'GUS_SERVICE_UNAVAILABLE',
      message: `GUS service error during ${operation}`,
      correlationId,
      source: 'GUS',
      details: { operation, originalError: errorMessage },
    });
  }

  /**
   * Check if error response indicates session expiration
   *
   * Used by caller (GusService) to determine if session should be cleared.
   *
   * @param errorResponse - ErrorResponse from handleSoapError()
   * @returns true if session should be cleared
   */
  isSessionExpiredError(errorResponse: ErrorResponse): boolean {
    return errorResponse.errorCode === 'GUS_SESSION_EXPIRED';
  }
}
