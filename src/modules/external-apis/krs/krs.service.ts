import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { z } from 'zod';
import {
  createErrorResponse,
  ErrorResponseCreators,
  type ErrorResponse,
} from '@schemas/error-response.schema.js';
import { validateEnvironment } from '@config/environment.schema.js';

/**
 * KRS REST Service for Polish Court Register API
 *
 * Handles:
 * - REST API calls to api-krs.ms.gov.pl
 * - P→S registry fallback strategy (Entrepreneurs → Associations)
 * - Rate limiting and timeout handling
 * - Response validation with Zod schemas
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
  nazwa: z.string(),
  nip: z
    .string()
    .regex(/^\d{10}$/)
    .optional(),
  regon: z.string().optional(),
  krs: z.string().regex(/^\d{10}$/),
});

const KrsSeatAddressSchema = z.object({
  adres: KrsAddressSchema,
});

const KrsPartnerSchema = z.object({
  nazwa: z.string(),
  adres: z.string(),
});

const KrsSection1Schema = z.object({
  danePodmiotu: KrsEntityDataSchema,
  siedzibaiAdres: KrsSeatAddressSchema.optional(),
});

const KrsSection2Schema = z.object({
  wspolnicy: z.array(KrsPartnerSchema).optional(),
});

const KrsDataSchema = z.object({
  dzial1: KrsSection1Schema,
  dzial2: KrsSection2Schema.optional(),
});

const KrsHeaderSchema = z.object({
  stanNa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const KrsResponseSchema = z.object({
  odpis: z.object({
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

  constructor() {
    const env = validateEnvironment();
    this.config = {
      baseUrl: env.KRS_BASE_URL,
      timeout: env.EXTERNAL_API_TIMEOUT,
      retryConfig: {
        maxRetries: env.KRS_MAX_RETRIES,
        initialDelay: env.KRS_INITIAL_DELAY,
      },
    };

    // Configure axios client
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
   * Fetch company data by KRS number with P→S registry fallback
   */
  async fetchCompanyByKrs(
    krsNumber: string,
    correlationId: string,
  ): Promise<KrsResponse> {
    this.logger.log(`Fetching KRS data for: ${krsNumber}`, { correlationId });

    // Validate KRS number format
    if (!this.isValidKrsNumber(krsNumber)) {
      throw createErrorResponse({
        errorCode: 'INVALID_REQUEST_FORMAT',
        message: `Invalid KRS number format: ${krsNumber}. Expected 10 digits.`,
        correlationId,
        source: 'INTERNAL',
      });
    }

    // Try P registry first (entrepreneurs), then S registry (associations)
    const registryTypes: RegistryType[] = ['P', 'S'];

    for (const registry of registryTypes) {
      try {
        this.logger.log(`Trying KRS registry: ${registry}`, {
          correlationId,
          krsNumber,
        });

        const response = await this.makeKrsRequest(
          krsNumber,
          registry,
          correlationId,
        );

        // Validate response with Zod
        const validatedData = KrsResponseSchema.parse(response.data);

        this.logger.log(`KRS data found in registry: ${registry}`, {
          correlationId,
          krsNumber,
          companyName: validatedData.odpis.dane.dzial1.danePodmiotu.nazwa,
        });

        return validatedData;
      } catch (error) {
        // If 404 in P registry, try S registry
        if (this.isNotFoundError(error) && registry === 'P') {
          this.logger.log(`Entity not found in P registry, trying S registry`, {
            correlationId,
            krsNumber,
          });
          continue;
        }

        // If this is the last registry or a non-404 error, handle it
        if (registry === 'S' || !this.isNotFoundError(error)) {
          throw this.handleKrsError(error, correlationId, krsNumber, registry);
        }
      }
    }

    // If we get here, entity was not found in any registry
    throw createErrorResponse({
      errorCode: 'ENTITY_NOT_FOUND',
      message: `Entity not found in KRS for number: ${krsNumber}`,
      correlationId,
      source: 'KRS',
    });
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
   * Check if error is a 404 Not Found
   */
  private isNotFoundError(error: any): boolean {
    return (
      error.response?.status === 404 || error.errorCode === 'ENTITY_NOT_FOUND'
    );
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
}

// Utility functions for data mapping
export const KrsMappers = {
  /**
   * Extract basic company information from KRS response
   */
  extractBasicInfo: (krsResponse: KrsResponse) => {
    const entity = krsResponse.odpis.dane.dzial1.danePodmiotu;
    const address = krsResponse.odpis.dane.dzial1.siedzibaiAdres?.adres;

    return {
      nazwa: entity.nazwa,
      nip: entity.nip,
      regon: entity.regon,
      krs: entity.krs,
      adres: address
        ? {
            miejscowosc: address.miejscowosc,
            kodPocztowy: address.kodPocztowy,
            ulica: address.ulica,
            numerBudynku: address.nrDomu,
            numerLokalu: address.nrLokalu,
          }
        : undefined,
      dataStanu: krsResponse.odpis.naglowekA.stanNa,
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
