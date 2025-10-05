import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  createErrorResponse,
  type ErrorResponse,
  type ErrorSource,
} from '@schemas/error-response.schema';
import { type Environment } from '@config/environment.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import { AxiosErrorHandler } from '@common/handlers/axios-error.handler';
import { createAxiosLoggingInterceptors } from '@common/interceptors/axios-logging.interceptor';
import { isAxiosError } from '@common/utils/error-detection.utils';
import {
  CeidgResponseSchema,
  type CeidgResponse,
  type CeidgCompany,
  type CeidgAddress,
} from './schemas/ceidg-response.schema';

/**
 * CEIDG v3 REST Service for Polish Individual Entrepreneurs Registry
 *
 * Handles:
 * - REST API calls to dane.biznes.gov.pl/api/ceidg/v3
 * - JWT Bearer token authentication
 * - Pagination and response parsing
 * - Rate limiting handling (1000 requests/hour)
 *
 * Retry Strategy:
 * - Service-level retry is NOT implemented (methods throw errors directly)
 * - Retry logic is handled by orchestration.machine.ts using retry.machine.ts
 * - Configuration: CEIDG_MAX_RETRIES (default 2), CEIDG_INITIAL_DELAY (default 150ms)
 * - Retries on: 5xx server errors (500, 502, 503)
 * - No retry on: 404 Not Found, 401 Auth Failed, 429 Rate Limit
 * - Exponential backoff with jitter managed by retry.machine.ts
 *
 * Constitutional compliance:
 * - All responses validated with Zod schemas
 * - Defensive programming against API failures
 * - Structured logging with correlation IDs
 * - Timeout and retry handling via state machines
 */

// CEIDG service configuration
interface CeidgConfig {
  baseUrl: string;
  jwtToken: string;
  timeout: number;
  retryConfig: {
    maxRetries: number;
    initialDelay: number;
  };
}

// Search parameters interface
// Basic JWT token only supports single NIP lookup without additional filters
interface CeidgSearchParams {
  nip: string; // Single NIP only (basic token doesn't support nip[] arrays)
}

@Injectable()
export class CeidgV3Service {
  private readonly logger = new Logger(CeidgV3Service.name);
  private readonly config: CeidgConfig;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly axiosErrorHandler: AxiosErrorHandler,
  ) {
    this.config = {
      baseUrl: this.configService.get('CEIDG_BASE_URL', { infer: true }),
      jwtToken: this.configService.get('CEIDG_JWT_TOKEN', { infer: true }),
      timeout: this.configService.get('APP_EXTERNAL_API_TIMEOUT', { infer: true }),
      retryConfig: {
        maxRetries: this.configService.get('CEIDG_MAX_RETRIES', { infer: true }),
        initialDelay: this.configService.get('CEIDG_INITIAL_DELAY', { infer: true }),
      },
    };

    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.jwtToken}`,
      },
      transitional: {
        clarifyTimeoutError: true, // Distinguish ETIMEDOUT from ECONNABORTED
      },
    });

    // Add unified axios logging interceptors (request + response)
    // Provides consistent logging across all REST API services
    // Authorization header is masked to prevent token leakage in logs
    const { requestInterceptor, responseInterceptor } =
      createAxiosLoggingInterceptors('CEIDG', this.logger, {
        maskHeaders: ['Authorization'],
      });
    this.httpClient.interceptors.request.use(...requestInterceptor);
    this.httpClient.interceptors.response.use(...responseInterceptor);
  }


  /**
   * Get company by single NIP
   * Simplified implementation using direct API call with minimal parameters
   */
  async getCompanyByNip(
    nip: string,
    correlationId: string,
  ): Promise<CeidgCompany | null> {
    this.logger.log(`Getting CEIDG company for NIP: ${nip}`, {
      correlationId,
    });

    // Use minimal parameters - only NIP as string (not array)
    // Token doesn't support page/per_page/status[] parameters
    const searchParams: CeidgSearchParams = {
      nip, // Single NIP as string (not 'nip[]' array)
    };

    try {
      const response = await this.makeCeidgRequest(
        '/firmy',
        searchParams,
        correlationId,
      );

      // DEBUG: Log raw response before validation
      this.logger.debug(`Raw CEIDG response before validation`, {
        correlationId,
        responseKeys: Object.keys(response.data),
        hasFirmy: 'firmy' in response.data,
        firmyCount: response.data.firmy?.length,
        firstCompanyKeys: response.data.firmy?.[0] ? Object.keys(response.data.firmy[0]) : [],
        firstCompanyAdresKeys: response.data.firmy?.[0]?.adresDzialalnosci ? Object.keys(response.data.firmy[0].adresDzialalnosci) : [],
        rawResponsePreview: JSON.stringify(response.data).substring(0, 500),
      });

      // Validate response with Zod using safeParse
      const validation = CeidgResponseSchema.safeParse(response.data);
      if (!validation.success) {
        this.logger.error(`CEIDG API response failed schema validation`, {
          correlationId,
          nip,
          zodErrors: validation.error.issues,
          responsePreview: JSON.stringify(response.data).substring(0, 500),
        });

        const errorResponse = createErrorResponse({
          errorCode: 'CEIDG_VALIDATION_FAILED',
          message: 'CEIDG API response failed schema validation',
          correlationId,
          source: 'CEIDG',
          details: {
            zodErrors: validation.error.issues,
            nip,
          },
        });
        throw new BusinessException(errorResponse);
      }

      const validatedData = validation.data;

      this.logger.log(`CEIDG company lookup completed`, {
        correlationId,
        nip,
        companiesFound: validatedData.firmy.length,
      });

      // Return first company if found, null otherwise
      return validatedData.firmy.length > 0 ? validatedData.firmy[0] : null;
    } catch (error) {
      // Convert error to standardized ErrorResponse format using generic handler
      const errorResponse = this.axiosErrorHandler.handleAxiosError(
        error,
        correlationId,
        'CEIDG',
        { nips: [nip], operation: 'getCompanyByNip' },
        { statusCodeHandler: this.handleCeidgStatusCode.bind(this) },
      );
      throw new BusinessException(errorResponse);
    }
  }


  /**
   * Make HTTP request to CEIDG API
   * Simplified for basic JWT token - only single NIP parameter supported
   */
  private async makeCeidgRequest(
    endpoint: string,
    params: CeidgSearchParams,
    correlationId: string,
  ): Promise<AxiosResponse> {
    // Basic JWT token only supports single NIP parameter
    // No arrays (nip[]), no status filters (status[]), no pagination
    const axiosParams: Record<string, unknown> = {
      nip: params.nip, // Single NIP as simple parameter
    };

    this.logger.debug(`Making CEIDG request`, {
      endpoint,
      correlationId,
      nip: params.nip,
      axiosParams, // Log exact params being sent
      authorizationHeader: `Bearer ${this.config.jwtToken.substring(0, 30)}...`, // Log first 30 chars
      fullTokenLength: this.config.jwtToken.length,
    });

    try {
      const startTime = Date.now();

      const response = await this.httpClient.get(endpoint, {
        params: axiosParams,
        headers: {
          'X-Correlation-ID': correlationId,
        },
      });

      const responseTime = Date.now() - startTime;
      this.logger.log(`CEIDG request completed`, {
        endpoint,
        status: response.status,
        responseTime,
        correlationId,
        resultCount:
          (response.data as { firmy?: unknown[] })?.firmy?.length || 0,
      });

      return response;
    } catch (error: unknown) {
      const responseTime = Date.now();
      const errorObj = error as {
        message?: string;
        response?: { status?: number };
      };
      this.logger.error(`CEIDG request failed`, {
        endpoint,
        error: errorObj.message,
        status: errorObj.response?.status,
        correlationId,
        responseTime,
      });

      throw error;
    }
  }

  /**
   * Handle CEIDG-specific HTTP status codes
   *
   * This method provides custom handling for CEIDG-specific status codes.
   * Common status codes (500, 502, 503) are handled by AxiosErrorHandler.
   *
   * @param statusCode - HTTP status code
   * @param error - Original error object
   * @param correlationId - Request correlation ID
   * @param source - Error source (always 'CEIDG')
   * @param context - CEIDG-specific context
   * @returns ErrorResponse for custom status codes, undefined for default handling
   */
  private handleCeidgStatusCode(
    statusCode: number,
    error: unknown,
    correlationId: string,
    source: ErrorSource,
    context: { nips?: string[]; operation?: string },
  ): ErrorResponse | undefined {
    const { nips, operation } = context;

    switch (statusCode) {
      case 401:
        return createErrorResponse({
          errorCode: 'CEIDG_AUTHENTICATION_FAILED',
          message: 'CEIDG authentication failed - invalid or expired JWT token',
          correlationId,
          source: 'CEIDG',
          details: { operation, status: statusCode, nips },
        });

      case 403:
        return createErrorResponse({
          errorCode: 'INSUFFICIENT_PERMISSIONS',
          message: 'Insufficient permissions for CEIDG API access',
          correlationId,
          source: 'CEIDG',
          details: { operation, status: statusCode, nips },
        });

      case 404:
        return createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No entities found in CEIDG for provided NIPs: ${nips?.join(', ') || 'unknown'}`,
          correlationId,
          source: 'CEIDG',
          details: { operation, nips },
        });

      case 429:
        const retryAfter = isAxiosError(error)
          ? error.response?.headers?.['retry-after'] || '3600'
          : '3600';
        return createErrorResponse({
          errorCode: 'CEIDG_RATE_LIMIT',
          message: `CEIDG rate limit exceeded. Retry after ${retryAfter} seconds.`,
          correlationId,
          source: 'CEIDG',
          details: {
            operation,
            retryAfter: parseInt(String(retryAfter), 10),
            nips,
          },
        });

      case 400:
        const errorMessage = isAxiosError(error)
          ? (error.response?.data as any)?.message || 'Bad request'
          : 'Bad request';
        return createErrorResponse({
          errorCode: 'INVALID_REQUEST_FORMAT',
          message: `Invalid request format for CEIDG API: ${errorMessage}`,
          correlationId,
          source: 'CEIDG',
          details: { operation, status: statusCode, nips },
        });

      default:
        // Return undefined to use AxiosErrorHandler default handling
        return undefined;
    }
  }

  /**
   * Health check - lightweight API availability test
   *
   * We accept 200, 400, 401, and 405 status codes as "healthy" -
   * what matters is that the service responded (not network timeout/connection error).
   * 401 means authentication required but service is available.
   * 405 Method Not Allowed also means service is responding.
   */
  async checkHealth(): Promise<'healthy' | 'unhealthy'> {
    try {
      // GET request with minimal invalid NIP to check API availability
      // We expect 400/401 response which means service is alive
      const response = await this.httpClient.get('/firmy', {
        params: { nip: '0' }, // Invalid NIP to trigger quick 400 response
        timeout: 5000,
        validateStatus: (status) =>
          status === 200 || status === 400 || status === 401 || status === 405,
      });

      this.logger.log('CEIDG health check passed', {
        status: response.status,
      });

      return 'healthy';
    } catch (error) {
      this.logger.warn('CEIDG health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return 'unhealthy';
    }
  }
}
