import type { Logger } from '@nestjs/common';
import type {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosError,
} from 'axios';

/**
 * Axios Logging Interceptor - Unified Request/Response Logging
 *
 * Factory function that creates standardized axios interceptors for consistent
 * logging across all REST API services (KRS, CEIDG, future services).
 *
 * Features:
 * - Request logging (debug): method, url, params, correlationId
 * - Response logging (success): status, responseTime, correlationId
 * - Error logging: status, url, method, correlationId, responseTime
 * - Performance tracking: automatic responseTime measurement
 * - Correlation ID extraction: from X-Correlation-ID header
 * - Sensitive data masking: Authorization header, Bearer tokens
 *
 * Architecture:
 * - Single Responsibility: Only logging (no error transformation)
 * - Consistency: Same log format across all services
 * - Performance: Minimal overhead (~1-2ms per request)
 * - Type-safe: Full TypeScript support
 *
 * Usage:
 * ```typescript
 * const { requestInterceptor, responseInterceptor } = createAxiosLoggingInterceptors(
 *   'KRS',
 *   this.logger,
 *   { maskHeaders: ['Authorization'] }
 * );
 * this.httpClient.interceptors.request.use(...requestInterceptor);
 * this.httpClient.interceptors.response.use(...responseInterceptor);
 * ```
 *
 * Benefits vs inline interceptors:
 * - Eliminates code duplication (~70 lines saved across KRS + CEIDG)
 * - Centralized log format changes
 * - Easy to extend with metrics/tracing
 * - Testable in isolation
 */

/**
 * Configuration options for axios logging interceptors
 */
export interface AxiosLoggingOptions {
  /** Headers to mask in logs (e.g., 'Authorization') */
  maskHeaders?: string[];

  /** Log level for requests (default: 'debug') */
  requestLogLevel?: 'debug' | 'log' | 'verbose';

  /** Log level for successful responses (default: 'log') */
  responseLogLevel?: 'debug' | 'log' | 'verbose';

  /** Log response body size (default: true) */
  logResponseSize?: boolean;

  /** Log request params (default: true) */
  logRequestParams?: boolean;
}

/**
 * Extended AxiosRequestConfig with metadata for performance tracking
 */
interface AxiosRequestConfigWithMetadata extends InternalAxiosRequestConfig {
  _startTime?: number;
}

/**
 * Extract correlation ID from request headers
 *
 * Checks standard correlation ID headers in priority order:
 * 1. X-Correlation-ID
 * 2. x-correlation-id
 * 3. correlation-id
 *
 * @param config - Axios request configuration
 * @returns Correlation ID or undefined if not found
 */
function extractCorrelationId(
  config: AxiosRequestConfig | InternalAxiosRequestConfig,
): string | undefined {
  const headers = config.headers || {};

  return (
    headers['X-Correlation-ID'] ||
    headers['x-correlation-id'] ||
    headers['correlation-id'] ||
    undefined
  );
}

/**
 * Mask sensitive headers for logging
 *
 * Replaces header values with masked version to prevent leaking secrets.
 * For Authorization headers, shows only token type (e.g., "Bearer ***").
 *
 * @param headers - Request headers
 * @param headersToMask - Array of header names to mask
 * @returns Headers with sensitive values masked
 */
function maskSensitiveHeaders(
  headers: Record<string, unknown>,
  headersToMask: string[] = [],
): Record<string, unknown> {
  if (headersToMask.length === 0) {
    return headers;
  }

  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (headersToMask.some((h) => h.toLowerCase() === key.toLowerCase())) {
      // Special handling for Authorization header
      if (key.toLowerCase() === 'authorization' && typeof value === 'string') {
        const parts = value.split(' ');
        masked[key] = parts.length > 1 ? `${parts[0]} ***` : '***';
      } else {
        masked[key] = '***';
      }
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

/**
 * Calculate response time from request start timestamp
 *
 * @param config - Axios request configuration with _startTime metadata
 * @returns Response time in milliseconds, or undefined if startTime not set
 */
function calculateResponseTime(
  config: AxiosRequestConfigWithMetadata,
): number | undefined {
  if (!config._startTime) {
    return undefined;
  }

  return Date.now() - config._startTime;
}

/**
 * Create axios logging interceptors for a service
 *
 * Returns a pair of interceptors (request + response) configured for the service.
 * Both interceptors use the provided logger and follow consistent log formats.
 *
 * @param serviceName - Name of the service (e.g., 'KRS', 'CEIDG')
 * @param logger - NestJS Logger instance from the service
 * @param options - Configuration options for logging behavior
 * @returns Object with requestInterceptor and responseInterceptor functions
 *
 * @example
 * ```typescript
 * constructor(private readonly logger = new Logger(KrsService.name)) {
 *   const { requestInterceptor, responseInterceptor } = createAxiosLoggingInterceptors(
 *     'KRS',
 *     this.logger
 *   );
 *   this.httpClient.interceptors.request.use(...requestInterceptor);
 *   this.httpClient.interceptors.response.use(...responseInterceptor);
 * }
 * ```
 */
export function createAxiosLoggingInterceptors(
  serviceName: string,
  logger: Logger,
  options: AxiosLoggingOptions = {},
) {
  const {
    maskHeaders = [],
    requestLogLevel = 'debug',
    responseLogLevel = 'log',
    logResponseSize = true,
    logRequestParams = true,
  } = options;

  /**
   * Request Interceptor
   *
   * Logs outgoing requests and records start time for performance tracking.
   */
  const requestInterceptor = [
    (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      // Add start time for response time calculation
      const configWithMetadata = config as AxiosRequestConfigWithMetadata;
      configWithMetadata._startTime = Date.now();

      // Extract correlation ID
      const correlationId = extractCorrelationId(config);

      // Build log metadata
      const logMetadata: Record<string, unknown> = {
        service: serviceName,
        method: config.method?.toUpperCase(),
        url: config.url,
        correlationId,
      };

      // Add params if enabled
      if (logRequestParams && config.params) {
        logMetadata.params = config.params;
      }

      // Add masked headers if configured
      if (maskHeaders.length > 0 && config.headers) {
        logMetadata.headers = maskSensitiveHeaders(
          config.headers as Record<string, unknown>,
          maskHeaders,
        );
      }

      // Log request
      logger[requestLogLevel](`${serviceName} API request`, logMetadata);

      return config;
    },
    (error: unknown) => Promise.reject(error),
  ] as const;

  /**
   * Response Interceptor
   *
   * Logs successful responses and errors with performance metrics.
   */
  const responseInterceptor = [
    // Success handler
    (response: AxiosResponse): AxiosResponse => {
      const config = response.config as AxiosRequestConfigWithMetadata;
      const correlationId = extractCorrelationId(config);
      const responseTime = calculateResponseTime(config);

      // Build log metadata
      const logMetadata: Record<string, unknown> = {
        service: serviceName,
        method: config.method?.toUpperCase(),
        url: config.url,
        status: response.status,
        statusText: response.statusText,
        correlationId,
      };

      // Add response time if available
      if (responseTime !== undefined) {
        logMetadata.responseTime = responseTime;
      }

      // Add response size if enabled
      if (logResponseSize && response.data) {
        const dataSize = JSON.stringify(response.data).length;
        logMetadata.responseSize = dataSize;
      }

      // Log successful response
      logger[responseLogLevel](`${serviceName} API response`, logMetadata);

      return response;
    },

    // Error handler
    (error: unknown): Promise<never> => {
      const axiosError = error as AxiosError;
      const config = axiosError.config as
        | AxiosRequestConfigWithMetadata
        | undefined;
      const correlationId = config ? extractCorrelationId(config) : undefined;
      const responseTime = config ? calculateResponseTime(config) : undefined;

      // Build error log metadata
      const logMetadata: Record<string, unknown> = {
        service: serviceName,
        method: config?.method?.toUpperCase(),
        url: config?.url,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        correlationId,
        errorCode: axiosError.code,
      };

      // Add response time if available
      if (responseTime !== undefined) {
        logMetadata.responseTime = responseTime;
      }

      // Log error
      logger.error(`${serviceName} API error`, logMetadata);

      // Preserve original error for proper error handling
      return Promise.reject(error);
    },
  ] as const;

  return {
    requestInterceptor,
    responseInterceptor,
  };
}
