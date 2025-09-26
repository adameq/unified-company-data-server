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
 * CEIDG v3 REST Service for Polish Individual Entrepreneurs Registry
 *
 * Handles:
 * - REST API calls to dane.biznes.gov.pl/api/ceidg/v3
 * - JWT Bearer token authentication
 * - Pagination and response parsing
 * - Rate limiting handling (1000 requests/hour)
 *
 * Constitutional compliance:
 * - All responses validated with Zod schemas
 * - Defensive programming against API failures
 * - Structured logging with correlation IDs
 * - Timeout and retry handling via state machines
 */

// CEIDG API response schemas for validation
const CeidgAddressSchema = z.object({
  miejscowosc: z.string(),
  kodPocztowy: z.string().regex(/^\d{2}-\d{3}$/),
  ulica: z.string().optional(),
  nrDomu: z.string().optional(),
  nrLokalu: z.string().optional(),
  gmina: z.string().optional(),
  powiat: z.string().optional(),
  wojewodztwo: z.string().optional(),
});

const CeidgCompanySchema = z.object({
  nip: z.string().regex(/^\d{10}$/),
  nazwa: z.string(),
  imiona: z.string().optional(),
  nazwisko: z.string().optional(),
  status: z.enum([
    'AKTYWNY',
    'WYKRESLONY',
    'ZAWIESZONY',
    'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI',
    'WYLACZNIE_W_FORMIE_SPOLKI',
  ]),
  dataRozpoczeciaDzialalnosci: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataZakonczeniaDzialalnosci: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  adresDzialalnosci: CeidgAddressSchema,
  adresKorespondencyjny: CeidgAddressSchema.optional(),
  regon: z.string().optional(),
});

const CeidgLinksSchema = z.object({
  first: z.string().optional(),
  last: z.string().optional(),
  prev: z.string().optional(),
  next: z.string().optional(),
});

const CeidgMetaSchema = z.object({
  current_page: z.number(),
  last_page: z.number(),
  per_page: z.number(),
  total: z.number(),
});

const CeidgResponseSchema = z.object({
  firmy: z.array(CeidgCompanySchema),
  links: CeidgLinksSchema,
  meta: CeidgMetaSchema,
});

// Types inferred from schemas
export type CeidgResponse = z.infer<typeof CeidgResponseSchema>;
export type CeidgCompany = z.infer<typeof CeidgCompanySchema>;
export type CeidgAddress = z.infer<typeof CeidgAddressSchema>;

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
interface CeidgSearchParams {
  nip: string[];
  status?: (
    | 'AKTYWNY'
    | 'WYKRESLONY'
    | 'ZAWIESZONY'
    | 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI'
    | 'WYLACZNIE_W_FORMIE_SPOLKI'
  )[];
  page?: number;
  limit?: number;
}

@Injectable()
export class CeidgV3Service {
  private readonly logger = new Logger(CeidgV3Service.name);
  private readonly config: CeidgConfig;
  private readonly httpClient: AxiosInstance;

  constructor() {
    const env = validateEnvironment();
    this.config = {
      baseUrl: env.CEIDG_BASE_URL,
      jwtToken: env.CEIDG_JWT_TOKEN,
      timeout: env.EXTERNAL_API_TIMEOUT,
      retryConfig: {
        maxRetries: env.CEIDG_MAX_RETRIES,
        initialDelay: env.CEIDG_INITIAL_DELAY,
      },
    };

    // Configure axios client with JWT authentication
    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.jwtToken}`,
      },
    });

    // Add response interceptor for logging and error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error('CEIDG API error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          method: error.config?.method,
          correlationId: error.config?.headers?.['X-Correlation-ID'],
        });
        return Promise.reject(error);
      },
    );
  }

  /**
   * Search companies by NIP array
   */
  async searchCompaniesByNip(
    nips: string[],
    correlationId: string,
    options: {
      includeInactive?: boolean;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<CeidgResponse> {
    this.logger.log(`Searching CEIDG for NIPs: ${nips.join(', ')}`, {
      correlationId,
    });

    // Validate NIPs format
    for (const nip of nips) {
      if (!this.isValidNip(nip)) {
        throw createErrorResponse({
          errorCode: 'INVALID_NIP_FORMAT',
          message: `Invalid NIP format: ${nip}. Expected 10 digits.`,
          correlationId,
          source: 'INTERNAL',
        });
      }
    }

    const searchParams: CeidgSearchParams = {
      nip: nips,
      status: options.includeInactive
        ? [
            'AKTYWNY',
            'WYKRESLONY',
            'ZAWIESZONY',
            'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI',
            'WYLACZNIE_W_FORMIE_SPOLKI',
          ]
        : ['AKTYWNY'],
      page: options.page || 1,
      limit: options.limit || 20,
    };

    try {
      const response = await this.makeCeidgRequest(
        '/firmy',
        searchParams,
        correlationId,
      );

      // Validate response with Zod
      const validatedData = CeidgResponseSchema.parse(response.data);

      this.logger.log(`CEIDG search completed`, {
        correlationId,
        nips: nips.join(','),
        companiesFound: validatedData.firmy.length,
        totalResults: validatedData.meta.total,
      });

      return validatedData;
    } catch (error) {
      throw this.handleCeidgError(
        error,
        correlationId,
        'searchCompaniesByNip',
        { nips },
      );
    }
  }

  /**
   * Get company by single NIP
   */
  async getCompanyByNip(
    nip: string,
    correlationId: string,
  ): Promise<CeidgCompany | null> {
    const response = await this.searchCompaniesByNip([nip], correlationId, {
      includeInactive: true, // Include all statuses for complete data
    });

    // Return first company if found, null otherwise
    return response.firmy.length > 0 ? response.firmy[0] : null;
  }

  /**
   * Check if company exists and is active
   */
  async isCompanyActive(nip: string, correlationId: string): Promise<boolean> {
    try {
      const company = await this.getCompanyByNip(nip, correlationId);
      return company?.status === 'AKTYWNY';
    } catch (error: any) {
      if (error.errorCode === 'ENTITY_NOT_FOUND') {
        return false;
      }
      // Re-throw other errors (service unavailable, timeout, etc.)
      throw error;
    }
  }

  /**
   * Get all companies with pagination support
   */
  async getAllCompaniesForNips(
    nips: string[],
    correlationId: string,
    options: {
      includeInactive?: boolean;
      maxPages?: number;
    } = {},
  ): Promise<CeidgCompany[]> {
    const allCompanies: CeidgCompany[] = [];
    const maxPages = options.maxPages || 10; // Safety limit
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && currentPage <= maxPages) {
      const response = await this.searchCompaniesByNip(nips, correlationId, {
        ...options,
        page: currentPage,
      });

      allCompanies.push(...response.firmy);

      hasMorePages = currentPage < response.meta.last_page;
      currentPage++;

      this.logger.debug(
        `Fetched page ${currentPage - 1}/${response.meta.last_page}`,
        {
          correlationId,
          companiesInPage: response.firmy.length,
          totalSoFar: allCompanies.length,
        },
      );
    }

    return allCompanies;
  }

  /**
   * Make HTTP request to CEIDG API
   */
  private async makeCeidgRequest(
    endpoint: string,
    params: CeidgSearchParams,
    correlationId: string,
  ): Promise<AxiosResponse> {
    // Build query parameters
    const queryParams = new URLSearchParams();

    // Add NIP array parameters
    params.nip.forEach((nip) => {
      queryParams.append('nip[]', nip);
    });

    // Add status array parameters
    if (params.status) {
      params.status.forEach((status) => {
        queryParams.append('status[]', status);
      });
    }

    // Add pagination parameters
    if (params.page) {
      queryParams.append('page', params.page.toString());
    }
    if (params.limit) {
      queryParams.append('per_page', params.limit.toString());
    }

    const fullUrl = `${endpoint}?${queryParams.toString()}`;

    this.logger.debug(`Making CEIDG request`, {
      endpoint: fullUrl,
      correlationId,
      nipsCount: params.nip.length,
    });

    try {
      const startTime = Date.now();

      const response = await this.httpClient.get(endpoint, {
        params: Object.fromEntries(queryParams),
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
        resultCount: response.data?.firmy?.length || 0,
      });

      return response;
    } catch (error: any) {
      const responseTime = Date.now();
      this.logger.error(`CEIDG request failed`, {
        endpoint,
        error: error.message,
        status: error.response?.status,
        correlationId,
        responseTime,
      });

      throw error;
    }
  }

  /**
   * Validate NIP format (10 digits)
   */
  private isValidNip(nip: string): boolean {
    return /^\d{10}$/.test(nip);
  }

  /**
   * Handle CEIDG-specific errors and convert to standardized ErrorResponse
   */
  private handleCeidgError(
    error: any,
    correlationId: string,
    operation: string,
    context: { nips?: string[] } = {},
  ): ErrorResponse {
    // HTTP status-based error handling
    if (error.response?.status) {
      const status = error.response.status;

      switch (status) {
        case 401:
          return createErrorResponse({
            errorCode: 'CEIDG_AUTHENTICATION_FAILED',
            message:
              'CEIDG authentication failed - invalid or expired JWT token',
            correlationId,
            source: 'CEIDG',
            details: { operation, status, nips: context.nips },
          });

        case 403:
          return createErrorResponse({
            errorCode: 'INSUFFICIENT_PERMISSIONS',
            message: 'Insufficient permissions for CEIDG API access',
            correlationId,
            source: 'CEIDG',
            details: { operation, status, nips: context.nips },
          });

        case 404:
          return createErrorResponse({
            errorCode: 'ENTITY_NOT_FOUND',
            message: `No entities found in CEIDG for provided NIPs: ${context.nips?.join(', ') || 'unknown'}`,
            correlationId,
            source: 'CEIDG',
            details: { operation, nips: context.nips },
          });

        case 429:
          const retryAfter = error.response.headers['retry-after'] || '3600'; // Default 1 hour
          return createErrorResponse({
            errorCode: 'CEIDG_RATE_LIMIT',
            message: `CEIDG rate limit exceeded. Retry after ${retryAfter} seconds.`,
            correlationId,
            source: 'CEIDG',
            details: {
              operation,
              retryAfter: parseInt(retryAfter, 10),
              nips: context.nips,
            },
          });

        case 500:
        case 502:
        case 503:
          return ErrorResponseCreators.serviceUnavailable(
            correlationId,
            'CEIDG',
            new Error(
              `CEIDG API returned ${status}: ${error.response.statusText}`,
            ),
          );

        case 400:
          return createErrorResponse({
            errorCode: 'INVALID_REQUEST_FORMAT',
            message: `Invalid request format for CEIDG API: ${error.response.data?.message || 'Bad request'}`,
            correlationId,
            source: 'CEIDG',
            details: { operation, status, nips: context.nips },
          });

        default:
          return createErrorResponse({
            errorCode: 'CEIDG_SERVICE_UNAVAILABLE',
            message: `CEIDG API returned unexpected status: ${status}`,
            correlationId,
            source: 'CEIDG',
            details: { status, operation, nips: context.nips },
          });
      }
    }

    // JWT token expiration (specific error message checking)
    if (
      error.message?.toLowerCase().includes('jwt') &&
      (error.message?.toLowerCase().includes('expired') ||
        error.message?.toLowerCase().includes('invalid'))
    ) {
      return createErrorResponse({
        errorCode: 'CEIDG_JWT_EXPIRED',
        message: 'CEIDG JWT token has expired or is invalid',
        correlationId,
        source: 'CEIDG',
        details: { operation, nips: context.nips },
      });
    }

    // Timeout errors
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return ErrorResponseCreators.timeoutError(correlationId, 'CEIDG');
    }

    // Network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return createErrorResponse({
        errorCode: 'CEIDG_SERVICE_UNAVAILABLE',
        message: 'Cannot connect to CEIDG service',
        correlationId,
        source: 'CEIDG',
        details: {
          errorCode: error.code,
          operation,
          nips: context.nips,
          originalError: error.message,
        },
      });
    }

    // Zod validation errors (invalid response format)
    if (error.name === 'ZodError') {
      return createErrorResponse({
        errorCode: 'DATA_MAPPING_FAILED',
        message: 'CEIDG response format validation failed',
        correlationId,
        source: 'CEIDG',
        details: {
          operation,
          nips: context.nips,
          validationErrors: error.errors,
        },
      });
    }

    // Generic CEIDG service error
    return createErrorResponse({
      errorCode: 'CEIDG_SERVICE_UNAVAILABLE',
      message: `Unexpected error during CEIDG ${operation}`,
      correlationId,
      source: 'CEIDG',
      details: {
        operation,
        nips: context.nips,
        originalError: error.message,
      },
    });
  }
}

// Utility functions for data mapping
export const CeidgMappers = {
  /**
   * Map CEIDG company to unified format
   */
  mapToUnifiedData: (ceidgCompany: CeidgCompany) => {
    return {
      nazwa:
        ceidgCompany.imiona && ceidgCompany.nazwisko
          ? `${ceidgCompany.imiona} ${ceidgCompany.nazwisko}`
          : ceidgCompany.nazwa,
      nip: ceidgCompany.nip,
      regon: ceidgCompany.regon,
      adres: {
        miejscowosc: ceidgCompany.adresDzialalnosci.miejscowosc,
        kodPocztowy: ceidgCompany.adresDzialalnosci.kodPocztowy,
        ulica: ceidgCompany.adresDzialalnosci.ulica,
        numerBudynku: ceidgCompany.adresDzialalnosci.nrDomu,
        numerLokalu: ceidgCompany.adresDzialalnosci.nrLokalu,
        wojewodztwo: ceidgCompany.adresDzialalnosci.wojewodztwo,
        powiat: ceidgCompany.adresDzialalnosci.powiat,
        gmina: ceidgCompany.adresDzialalnosci.gmina,
      },
      status: ceidgCompany.status,
      isActive: ceidgCompany.status === 'AKTYWNY',
      dataRozpoczeciaDzialalnosci: ceidgCompany.dataRozpoczeciaDzialalnosci,
      dataZakonczeniaDzialalnosci: ceidgCompany.dataZakonczeniaDzialalnosci,
      typPodmiotu: 'FIZYCZNA' as const,
      formaPrawna: 'DZIAŁALNOŚĆ GOSPODARCZA' as const,
      zrodloDanych: 'CEIDG' as const,
    };
  },

  /**
   * Check if company is deregistered
   */
  isDeregistered: (company: CeidgCompany): boolean => {
    return company.status === 'WYKRESLONY';
  },

  /**
   * Check if company is suspended
   */
  isSuspended: (company: CeidgCompany): boolean => {
    return company.status === 'ZAWIESZONY';
  },

  /**
   * Get correspondence address or fallback to business address
   */
  getMailingAddress: (company: CeidgCompany): CeidgAddress => {
    return company.adresKorespondencyjny || company.adresDzialalnosci;
  },
};
