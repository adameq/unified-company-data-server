import { Injectable, Logger } from '@nestjs/common';
import {
  createErrorResponse,
  ErrorResponseCreators,
  type ErrorResponse,
  type ErrorSource,
} from '@schemas/error-response.schema';
import {
  isTimeoutError,
  isNetworkError,
  getAxiosStatusCode,
  isAxiosError,
} from '@common/utils/error-detection.utils';

/**
 * Axios Error Handler - Generic REST API Error Handling
 *
 * Single Responsibility: Convert Axios errors to standardized ErrorResponse format
 *
 * Responsibilities:
 * - Handle HTTP status codes and convert to ErrorResponse
 * - Handle timeout errors (ECONNABORTED, ETIMEDOUT)
 * - Handle network errors (ECONNREFUSED, ENOTFOUND, ECONNRESET)
 * - Handle Zod validation errors (invalid response format)
 * - Support service-specific error code customization via strategy pattern
 *
 * NOT responsible for:
 * - Service-specific business logic
 * - SOAP errors (use GusErrorHandler)
 * - Validation errors (use ZodErrorHandler)
 *
 * Architecture:
 * - Follows same pattern as GusErrorHandler (architectural consistency)
 * - Uses existing utilities from error-detection.utils.ts
 * - Uses existing factories from ErrorResponseCreators
 * - Strategy pattern for service-specific HTTP status code handling
 *
 * Benefits:
 * - Eliminates code duplication between KRS and CEIDG services
 * - Single source of truth for REST API error handling
 * - Easy to extend for future REST API services
 * - Type-safe error detection (no string parsing)
 */

/**
 * Context for error handling - service-specific details
 */
export interface AxiosErrorContext {
  /** Operation name (e.g., 'fetchFromRegistry', 'getCompanyByNip') */
  operation?: string;
  /** KRS number (for KRS service) */
  krsNumber?: string;
  /** Registry type (for KRS service) */
  registry?: 'P' | 'S';
  /** NIPs array (for CEIDG service) */
  nips?: string[];
}

/**
 * Custom status code handler function
 */
export type StatusCodeHandler = (
  statusCode: number,
  error: unknown,
  correlationId: string,
  source: ErrorSource,
  context: AxiosErrorContext,
) => ErrorResponse | undefined;

/**
 * Options for customizing error handler behavior
 */
export interface AxiosErrorHandlerOptions {
  /**
   * Custom handler for HTTP status codes
   * Return ErrorResponse for custom handling, undefined to use default
   */
  statusCodeHandler?: StatusCodeHandler;
}

@Injectable()
export class AxiosErrorHandler {
  private readonly logger = new Logger(AxiosErrorHandler.name);

  /**
   * Handle Axios error and convert to standardized ErrorResponse
   *
   * @param error - Error from Axios request
   * @param correlationId - Request correlation ID
   * @param source - Error source (KRS, CEIDG, etc.)
   * @param context - Service-specific context for error details
   * @param options - Custom handling options
   * @returns Standardized ErrorResponse
   *
   * @example
   * // KRS service usage
   * const errorResponse = this.axiosErrorHandler.handleAxiosError(
   *   error,
   *   correlationId,
   *   'KRS',
   *   { krsNumber, registry, operation: 'fetchFromRegistry' },
   *   { statusCodeHandler: this.handleKrsStatusCode.bind(this) }
   * );
   *
   * @example
   * // CEIDG service usage
   * const errorResponse = this.axiosErrorHandler.handleAxiosError(
   *   error,
   *   correlationId,
   *   'CEIDG',
   *   { nips, operation: 'getCompanyByNip' },
   *   { statusCodeHandler: this.handleCeidgStatusCode.bind(this) }
   * );
   */
  handleAxiosError(
    error: unknown,
    correlationId: string,
    source: ErrorSource,
    context: AxiosErrorContext = {},
    options: AxiosErrorHandlerOptions = {},
  ): ErrorResponse {
    // 1. HTTP status code handling (service-specific via strategy)
    const statusCode = getAxiosStatusCode(error);
    if (statusCode !== undefined) {
      // Try custom handler first (service-specific)
      if (options.statusCodeHandler) {
        const customResponse = options.statusCodeHandler(
          statusCode,
          error,
          correlationId,
          source,
          context,
        );
        if (customResponse) {
          return customResponse;
        }
      }

      // Default status code handling (common across services)
      return this.handleCommonStatusCodes(
        statusCode,
        error,
        correlationId,
        source,
        context,
      );
    }

    // 2. Timeout errors (type-safe detection)
    if (isTimeoutError(error)) {
      return ErrorResponseCreators.timeoutError(correlationId, source);
    }

    // 3. Network/connection errors (type-safe detection)
    if (isNetworkError(error)) {
      const errorCode = isAxiosError(error) ? error.code : undefined;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Map source to specific error code (type-safe)
      const errorCodeMap = {
        GUS: 'GUS_SERVICE_UNAVAILABLE' as const,
        KRS: 'KRS_SERVICE_UNAVAILABLE' as const,
        CEIDG: 'CEIDG_SERVICE_UNAVAILABLE' as const,
        INTERNAL: 'CRITICAL_SERVICE_UNAVAILABLE' as const,
      };

      return createErrorResponse({
        errorCode: errorCodeMap[source],
        message: `Cannot connect to ${source} service`,
        correlationId,
        source,
        details: {
          errorCode,
          operation: context.operation,
          originalError: errorMessage,
        },
      });
    }

    // 4. Zod validation errors (invalid response format)
    const errorObj = error as { name?: string; errors?: unknown[] };
    if (errorObj.name === 'ZodError') {
      return createErrorResponse({
        errorCode: 'DATA_MAPPING_FAILED',
        message: `${source} response format validation failed`,
        correlationId,
        source,
        details: {
          operation: context.operation,
          validationErrors: errorObj.errors,
        },
      });
    }

    // 5. Generic service error (fallback)
    const genericMessage = error instanceof Error ? error.message : String(error);

    // Map source to specific error code (type-safe)
    const errorCodeMap = {
      GUS: 'GUS_SERVICE_UNAVAILABLE' as const,
      KRS: 'KRS_SERVICE_UNAVAILABLE' as const,
      CEIDG: 'CEIDG_SERVICE_UNAVAILABLE' as const,
      INTERNAL: 'CRITICAL_SERVICE_UNAVAILABLE' as const,
    };

    return createErrorResponse({
      errorCode: errorCodeMap[source],
      message: `Unexpected error during ${source} ${context.operation || 'request'}`,
      correlationId,
      source,
      details: {
        operation: context.operation,
        originalError: genericMessage,
      },
    });
  }

  /**
   * Handle common HTTP status codes shared across services
   *
   * This method handles status codes that have identical behavior
   * across different REST API services (500, 502, 503).
   *
   * Service-specific status codes (404, 401, 429, etc.) should be
   * handled in the custom statusCodeHandler.
   */
  private handleCommonStatusCodes(
    statusCode: number,
    error: unknown,
    correlationId: string,
    source: ErrorSource,
    context: AxiosErrorContext,
  ): ErrorResponse {
    switch (statusCode) {
      case 500:
      case 502:
      case 503:
        const statusText = isAxiosError(error)
          ? error.response?.statusText
          : 'Service Unavailable';
        return ErrorResponseCreators.serviceUnavailable(
          correlationId,
          source,
          new Error(`${source} API returned ${statusCode}: ${statusText}`),
        );

      default:
        // Unknown status code - return generic error
        // Map source to specific error code (type-safe)
        const errorCodeMap = {
          GUS: 'GUS_SERVICE_UNAVAILABLE' as const,
          KRS: 'KRS_SERVICE_UNAVAILABLE' as const,
          CEIDG: 'CEIDG_SERVICE_UNAVAILABLE' as const,
          INTERNAL: 'CRITICAL_SERVICE_UNAVAILABLE' as const,
        };

        return createErrorResponse({
          errorCode: errorCodeMap[source],
          message: `${source} API returned unexpected status: ${statusCode}`,
          correlationId,
          source,
          details: {
            status: statusCode,
            operation: context.operation,
          },
        });
    }
  }
}
