import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { z } from 'zod';
import {
  createErrorResponse,
  ErrorResponseCreators,
  type ErrorResponse,
} from '@schemas/error-response.schema';
import { type Environment } from '@config/environment.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';

/**
 * KRS REST Service for Polish Court Register API
 *
 * Handles:
 * - REST API calls to api-krs.ms.gov.pl
 * - Rate limiting and timeout handling
 * - Response validation with Zod schemas
 *
 * Registry Selection:
 * - Registry selection (P vs S) is handled by orchestration layer
 * - This service only executes HTTP requests to specified registry
 * - P→S fallback logic is in orchestration-machine.provider.ts
 *
 * Retry Strategy:
 * - Service-level retry is NOT implemented (methods throw errors directly)
 * - Retry logic is handled by orchestration.machine.ts using retry.machine.ts
 * - Configuration: KRS_MAX_RETRIES (default 2), KRS_INITIAL_DELAY (default 200ms)
 * - Retries on: 5xx server errors (500, 502, 503)
 * - No retry on: 404 Not Found, 400 Bad Request, 429 Rate Limit
 * - Exponential backoff with jitter managed by retry.machine.ts
 *
 * Constitutional compliance:
 * - All responses validated with Zod schemas
 * - Defensive programming against API failures
 * - Structured logging with correlation IDs
 * - Timeout and retry handling via state machines
 */

// KRS API response schemas for validation
const KrsAddressSchema = z.object({
  kodPocztowy: z.string().regex(/^\d{2}-\d{3}$/),
  miejscowosc: z.string(),
  ulica: z.string().optional(),
  nrDomu: z.string().optional(),
  nrLokalu: z.string().optional(),
});

const KrsEntityDataSchema = z.object({
  formaPrawna: z.string(),
  identyfikatory: z.object({
    nip: z.string().regex(/^\d{10}$/),
    regon: z.string(),
  }),
  nazwa: z.string(),
  dataWykreslenia: z.string().nullable().optional(),
  czyPosiadaStatusOPP: z.boolean().optional(),
});

const KrsSeatAddressSchema = z.object({
  siedziba: z.object({
    kraj: z.string(),
    wojewodztwo: z.string(),
    powiat: z.string(),
    gmina: z.string(),
    miejscowosc: z.string(),
  }),
  adres: KrsAddressSchema,
});

const KrsPartnerSchema = z.object({
  nazwa: z.string(),
  adres: z.string(),
});

const KrsSection1Schema = z.object({
  danePodmiotu: KrsEntityDataSchema,
  siedzibaIAdres: KrsSeatAddressSchema.optional(),
});

const KrsSection2Schema = z.object({
  wspolnicy: z.array(KrsPartnerSchema).optional(),
});

// Dzial 6 schemas for bankruptcy and liquidation status (per dokumentacja.md section 3)
const KrsLiquidationSchema = z
  .object({
    dataRozpoczecia: z.string().optional(),
    // Other fields exist but we only need to detect presence
  })
  .passthrough(); // Allow additional fields we don't need to validate

const KrsBankruptcySchema = z
  .object({
    dataPostanowienia: z.string().optional(),
    // Other fields exist but we only need to detect presence
  })
  .passthrough();

const KrsSection6Schema = z
  .object({
    likwidacja: z.array(KrsLiquidationSchema).optional(),
    postepowanieUpadlosciowe: z.array(KrsBankruptcySchema).optional(),
  })
  .optional();

const KrsDataSchema = z.object({
  dzial1: KrsSection1Schema,
  dzial2: KrsSection2Schema.optional(),
  dzial6: KrsSection6Schema.optional(),
});

const KrsHeaderSchema = z.object({
  rejestr: z.string(),
  numerKRS: z.string(),
  stanZDnia: z.string(),
  dataRejestracjiWKRS: z.string().optional(),
  stanPozycji: z.number().optional(), // Entity status: 1=active, 3=deleted but visible, 4=deleted
});

export const KrsResponseSchema = z.object({
  odpis: z.object({
    rodzaj: z.string(),
    dane: KrsDataSchema,
    naglowekA: KrsHeaderSchema,
  }),
});

// Types inferred from schemas
export type KrsResponse = z.infer<typeof KrsResponseSchema>;
export type KrsEntityData = z.infer<typeof KrsEntityDataSchema>;
export type KrsAddress = z.infer<typeof KrsAddressSchema>;

// KRS service configuration
interface KrsConfig {
  baseUrl: string;
  timeout: number;
  retryConfig: {
    maxRetries: number;
    initialDelay: number;
  };
}

// Registry types for P→S fallback
type RegistryType = 'P' | 'S';

@Injectable()
export class KrsService {
  private readonly logger = new Logger(KrsService.name);
  private readonly config: KrsConfig;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService<Environment, true>,
  ) {
    this.config = {
      baseUrl: this.configService.get('KRS_BASE_URL', { infer: true }),
      timeout: this.configService.get('EXTERNAL_API_TIMEOUT', { infer: true }),
      retryConfig: {
        maxRetries: this.configService.get('KRS_MAX_RETRIES', { infer: true }),
        initialDelay: this.configService.get('KRS_INITIAL_DELAY', { infer: true }),
      },
    };

    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for logging
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error('KRS API error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          method: error.config?.method,
        });
        return Promise.reject(error);
      },
    );
  }

  /**
   * Fetch company data from specific KRS registry
   *
   * Registry selection (P vs S) is handled by orchestration layer.
   * This method only executes HTTP request to specified registry.
   *
   * @param krsNumber - 10-digit KRS number
   * @param registry - Registry type: 'P' (entrepreneurs) or 'S' (associations/foundations)
   * @param correlationId - Request correlation ID for tracking
   * @returns Validated KRS response data
   * @throws BusinessException with error code (404, 5xx, validation errors)
   */
  async fetchFromRegistry(
    krsNumber: string,
    registry: RegistryType,
    correlationId: string,
  ): Promise<KrsResponse> {
    this.logger.log(`Fetching KRS data from registry ${registry}`, {
      correlationId,
      krsNumber,
      registry,
    });

    // Validate KRS number format
    if (!this.isValidKrsNumber(krsNumber)) {
      throw createErrorResponse({
        errorCode: 'INVALID_REQUEST_FORMAT',
        message: `Invalid KRS number format: ${krsNumber}. Expected 10 digits.`,
        correlationId,
        source: 'INTERNAL',
      });
    }

    try {
      const response = await this.makeKrsRequest(
        krsNumber,
        registry,
        correlationId,
      );

      // Handle HTTP 204 No Content (deregistered entity)
      if (response.status === 204 || !response.data) {
        this.logger.log(`Entity is deregistered (HTTP 204 or empty response)`, {
          correlationId,
          krsNumber,
          registry,
          status: response.status,
        });

        throw createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `Entity not found in ${registry} registry (HTTP 204)`,
          correlationId,
          source: 'KRS',
          details: { registry, krsNumber },
        });
      }

      // Log raw KRS response for debugging
      this.logger.log(`Raw KRS API response received`, {
        correlationId,
        krsNumber,
        registry,
        responseKeys: Object.keys(response.data || {}),
        responseData: JSON.stringify(response.data, null, 2).substring(0, 2000),
      });

      // Validate response with Zod using safeParse
      const validation = KrsResponseSchema.safeParse(response.data);
      if (!validation.success) {
        this.logger.error(`KRS API response failed schema validation`, {
          correlationId,
          krsNumber,
          registry,
          zodErrors: validation.error.issues,
          responsePreview: JSON.stringify(response.data).substring(0, 500),
        });

        const errorResponse = createErrorResponse({
          errorCode: 'KRS_VALIDATION_FAILED',
          message: 'KRS API response failed schema validation',
          correlationId,
          source: 'KRS',
          details: {
            zodErrors: validation.error.issues,
            registry,
            krsNumber,
          },
        });
        throw new BusinessException(errorResponse);
      }

      const validatedData = validation.data;

      this.logger.log(`KRS response validated successfully`, {
        correlationId,
        krsNumber,
        registry,
        companyName: validatedData.odpis.dane.dzial1.danePodmiotu.nazwa,
        krsFromResponse: validatedData.odpis.naglowekA.numerKRS,
      });

      return validatedData;
    } catch (error) {
      // Convert error to standardized ErrorResponse format
      const errorResponse = this.handleKrsError(error, correlationId, krsNumber, registry);
      throw new BusinessException(errorResponse);
    }
  }

  /**
   * Fetch company data by KRS number (convenience method)
   *
   * @deprecated Use fetchFromRegistry() instead for better control.
   *             This method tries P registry only for backward compatibility.
   */
  async fetchCompanyByKrs(
    krsNumber: string,
    correlationId: string,
  ): Promise<KrsResponse> {
    return this.fetchFromRegistry(krsNumber, 'P', correlationId);
  }

  /**
   * Check if entity exists in KRS (lightweight check)
   */
  async checkEntityExists(
    krsNumber: string,
    correlationId: string,
  ): Promise<boolean> {
    try {
      await this.fetchCompanyByKrs(krsNumber, correlationId);
      return true;
    } catch (error: any) {
      if (error.errorCode === 'ENTITY_NOT_FOUND') {
        return false;
      }
      // Re-throw other errors (service unavailable, timeout, etc.)
      throw error;
    }
  }

  /**
   * Make HTTP request to KRS API
   */
  private async makeKrsRequest(
    krsNumber: string,
    registry: RegistryType,
    correlationId: string,
  ): Promise<AxiosResponse> {
    const endpoint = `/api/krs/OdpisAktualny/${krsNumber}`;
    const params = {
      rejestr: registry,
      format: 'json',
    };

    this.logger.debug(`Making KRS request`, {
      endpoint,
      params,
      correlationId,
      registry,
    });

    try {
      const startTime = Date.now();

      const response = await this.httpClient.get(endpoint, {
        params,
        headers: {
          'X-Correlation-ID': correlationId,
        },
        validateStatus: (status) => {
          // Accept 200 OK and 204 No Content (deregistered entity)
          // 404 will be rejected and caught in catch block
          return status >= 200 && status < 300;
        },
      });

      const responseTime = Date.now() - startTime;
      this.logger.log(`KRS request completed`, {
        endpoint,
        status: response.status,
        responseTime,
        correlationId,
        registry,
      });

      return response;
    } catch (error: any) {
      const responseTime = Date.now();
      this.logger.error(`KRS request failed`, {
        endpoint,
        error: error.message,
        status: error.response?.status,
        correlationId,
        registry,
        responseTime,
      });

      throw error;
    }
  }

  /**
   * Validate KRS number format (10 digits)
   */
  private isValidKrsNumber(krsNumber: string): boolean {
    return /^\d{10}$/.test(krsNumber);
  }

  /**
   * Handle KRS-specific errors and convert to standardized ErrorResponse
   */
  private handleKrsError(
    error: any,
    correlationId: string,
    krsNumber: string,
    registry: RegistryType,
  ): ErrorResponse {
    // HTTP status-based error handling
    if (error.response?.status) {
      const status = error.response.status;

      switch (status) {
        case 404:
          return createErrorResponse({
            errorCode: 'ENTITY_NOT_FOUND',
            message: `Entity not found in KRS registry ${registry} for number: ${krsNumber}`,
            correlationId,
            source: 'KRS',
            details: { krsNumber, registry, status },
          });

        case 429:
          const retryAfter = error.response.headers['retry-after'];
          const errorResponse = ErrorResponseCreators.rateLimitExceeded(
            correlationId,
            'KRS',
          );
          return {
            ...errorResponse,
            details: {
              ...errorResponse.details,
              retryAfter,
              registry,
              krsNumber,
            },
          };

        case 500:
        case 502:
        case 503:
          return ErrorResponseCreators.serviceUnavailable(
            correlationId,
            'KRS',
            new Error(
              `KRS API returned ${status}: ${error.response.statusText}`,
            ),
          );

        case 400:
          return createErrorResponse({
            errorCode: 'KRS_INVALID_REGISTRY',
            message: `Invalid registry type or KRS number format: ${registry}/${krsNumber}`,
            correlationId,
            source: 'KRS',
            details: { registry, krsNumber, status },
          });

        default:
          return createErrorResponse({
            errorCode: 'KRS_SERVICE_UNAVAILABLE',
            message: `KRS API returned unexpected status: ${status}`,
            correlationId,
            source: 'KRS',
            details: { status, registry, krsNumber },
          });
      }
    }

    // Timeout errors
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return ErrorResponseCreators.timeoutError(correlationId, 'KRS');
    }

    // Network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return createErrorResponse({
        errorCode: 'KRS_SERVICE_UNAVAILABLE',
        message: 'Cannot connect to KRS service',
        correlationId,
        source: 'KRS',
        details: {
          errorCode: error.code,
          registry,
          krsNumber,
          originalError: error.message,
        },
      });
    }

    // Zod validation errors (invalid response format)
    if (error.name === 'ZodError') {
      return createErrorResponse({
        errorCode: 'DATA_MAPPING_FAILED',
        message: 'KRS response format validation failed',
        correlationId,
        source: 'KRS',
        details: {
          registry,
          krsNumber,
          validationErrors: error.errors,
        },
      });
    }

    // Generic KRS service error
    return createErrorResponse({
      errorCode: 'KRS_SERVICE_UNAVAILABLE',
      message: `Unexpected error during KRS request for ${krsNumber}`,
      correlationId,
      source: 'KRS',
      details: {
        registry,
        krsNumber,
        originalError: error.message,
      },
    });
  }

  /**
   * Health check - lightweight API availability test
   * Uses HEAD request to minimize data transfer
   */
  async checkHealth(): Promise<'healthy' | 'unhealthy'> {
    try {
      // HEAD request with minimal KRS number to check API availability
      const response = await this.httpClient.head('/api/krs/P/0000000001', {
        timeout: 2000,
        validateStatus: (status) => status === 200 || status === 404,
      });

      this.logger.log('KRS health check passed', {
        status: response.status,
      });

      return 'healthy';
    } catch (error) {
      this.logger.warn('KRS health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return 'unhealthy';
    }
  }
}

// Utility functions for data mapping
export const KrsMappers = {
  /**
   * Extract basic company information from KRS response
   */
  extractBasicInfo: (krsResponse: KrsResponse) => {
    const entity = krsResponse.odpis.dane.dzial1.danePodmiotu;
    const address = krsResponse.odpis.dane.dzial1.siedzibaIAdres?.adres;

    return {
      nazwa: entity.nazwa,
      nip: entity.identyfikatory.nip || undefined,
      regon: entity.identyfikatory.regon,
      krs: krsResponse.odpis.naglowekA.numerKRS,
      adres: address
        ? {
            miejscowosc: address.miejscowosc,
            kodPocztowy: address.kodPocztowy,
            ulica: address.ulica,
            numerBudynku: address.nrDomu,
            numerLokalu: address.nrLokalu,
          }
        : undefined,
      dataStanu: krsResponse.odpis.naglowekA.stanZDnia,
    };
  },

  /**
   * Check if entity is active based on KRS data
   */
  isActive: (krsResponse: KrsResponse): boolean => {
    // Entity is active if it has a current record
    // More sophisticated logic could be added based on specific KRS fields
    return krsResponse.odpis.dane.dzial1.danePodmiotu.nazwa.length > 0;
  },

  /**
   * Extract partners/shareholders from KRS data
   */
  extractPartners: (krsResponse: KrsResponse) => {
    return krsResponse.odpis.dane.dzial2?.wspolnicy || [];
  },
};
