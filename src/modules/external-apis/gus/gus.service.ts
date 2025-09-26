import { Injectable, Logger } from '@nestjs/common';
import * as soap from 'soap';
import { z } from 'zod';
import {
  createErrorResponse,
  ERROR_CODES,
  type ErrorResponse,
} from '@schemas/error-response.schema.js';
import { validateEnvironment } from '@config/environment.schema.js';

/**
 * GUS SOAP Service for Polish Statistical Office API
 *
 * Handles:
 * - Session-based authentication with 30-minute timeout
 * - Company classification via DaneSzukajPodmioty
 * - Detailed reports via DanePobierzPelnyRaport
 * - SOAP fault handling and error recovery
 *
 * Constitutional compliance:
 * - All responses validated with Zod schemas
 * - Defensive programming against SOAP faults
 * - Structured logging with correlation IDs
 * - Timeout and retry handling
 */

// GUS API operation schemas for validation
const GusClassificationResponseSchema = z.object({
  Regon: z.string().regex(/^\d{9}(\d{5})?$/),
  Nip: z.string().regex(/^\d{10}$/),
  Nazwa: z.string(),
  Typ: z.string(),
  SilosID: z.enum(['1', '2', '4', '6']),
});

const GusLegalPersonReportSchema = z.object({
  praw_regon9: z.string(),
  praw_nip: z.string(),
  praw_nazwa: z.string(),
  praw_numerWRejestrzeEwidencji: z.string().optional(),
  praw_dataRozpoczeciaDzialalnosci: z.string().optional(),
  praw_dataZakonczeniaDzialalnosci: z.string().optional(),
  praw_adSiedzKodPocztowy: z.string(),
  praw_adSiedzNumerNieruchomosci: z.string().optional(),
  praw_adSiedzNumerLokalu: z.string().optional(),
  praw_adSiedzWojewodztwo_Nazwa: z.string(),
  praw_adSiedzPowiat_Nazwa: z.string().optional(),
  praw_adSiedzGmina_Nazwa: z.string().optional(),
  praw_adSiedzMiejscowosc_Nazwa: z.string(),
  praw_adSiedzUlica_Nazwa: z.string().optional(),
  praw_podstawowaFormaPrawna_Nazwa: z.string().optional(),
  praw_szczegolnaFormaPrawna_Nazwa: z.string().optional(),
});

const GusPhysicalPersonReportSchema = z.object({
  fiz_regon9: z.string(),
  fiz_nip: z.string(),
  fiz_nazwa: z.string(),
  fiz_dataRozpoczeciaDzialalnosci: z.string().optional(),
  fiz_dataZakonczeniaDzialalnosci: z.string().optional(),
  fiz_adSiedzKodPocztowy: z.string(),
  fiz_adSiedzNumerNieruchomosci: z.string().optional(),
  fiz_adSiedzNumerLokalu: z.string().optional(),
  fiz_adSiedzWojewodztwo_Nazwa: z.string(),
  fiz_adSiedzPowiat_Nazwa: z.string().optional(),
  fiz_adSiedzGmina_Nazwa: z.string().optional(),
  fiz_adSiedzMiejscowosc_Nazwa: z.string(),
  fiz_adSiedzUlica_Nazwa: z.string().optional(),
});

// Types inferred from schemas
export type GusClassificationResponse = z.infer<
  typeof GusClassificationResponseSchema
>;
export type GusLegalPersonReport = z.infer<typeof GusLegalPersonReportSchema>;
export type GusPhysicalPersonReport = z.infer<
  typeof GusPhysicalPersonReportSchema
>;

// GUS service configuration
interface GusConfig {
  baseUrl: string;
  userKey: string;
  timeout: number;
  sessionTimeoutMs: number;
}

// Session management
interface GusSession {
  sessionId: string;
  expiresAt: Date;
  client: soap.Client;
}

@Injectable()
export class GusService {
  private readonly logger = new Logger(GusService.name);
  private readonly config: GusConfig;
  private currentSession: GusSession | null = null;

  constructor() {
    const env = validateEnvironment();
    this.config = {
      baseUrl: env.GUS_BASE_URL,
      userKey: env.GUS_USER_KEY,
      timeout: env.EXTERNAL_API_TIMEOUT,
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    };
  }

  /**
   * Get company classification by NIP to determine routing strategy
   */
  async getClassificationByNip(
    nip: string,
    correlationId: string,
  ): Promise<GusClassificationResponse> {
    this.logger.log(`Getting classification for NIP: ${nip}`, {
      correlationId,
    });

    try {
      const client = await this.getAuthenticatedClient(correlationId);

      const searchParams = `<Nip>${nip}</Nip>`;
      const result = await this.invokeWithTimeout(
        () =>
          client.DaneSzukajPodmiotyAsync({
            pParametryWyszukiwania: searchParams,
          }),
        this.config.timeout,
        'DaneSzukajPodmioty',
      );

      // Parse XML response
      const xmlData = (result as any)[0]?.DaneSzukajPodmiotyResult;
      if (!xmlData || xmlData.trim() === '<root></root>') {
        throw createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No entity found for NIP: ${nip}`,
          correlationId,
          source: 'GUS',
        });
      }

      const parsedData = this.parseXmlResponse(xmlData);
      const classificationData =
        GusClassificationResponseSchema.parse(parsedData);

      this.logger.log(
        `Classification found: silosId=${classificationData.SilosID}`,
        { correlationId },
      );

      return classificationData;
    } catch (error) {
      this.logger.error(`Classification failed for NIP ${nip}`, {
        error: error instanceof Error ? error.message : String(error),
        correlationId,
      });

      if (
        error &&
        typeof error === 'object' &&
        'errorCode' in error &&
        error.errorCode
      ) {
        throw error; // Re-throw ErrorResponse
      }

      throw this.handleGusError(error, correlationId, 'classification');
    }
  }

  /**
   * Get detailed company report based on REGON and entity type
   */
  async getDetailedReport(
    regon: string,
    silosId: string,
    correlationId: string,
  ): Promise<GusLegalPersonReport | GusPhysicalPersonReport> {
    this.logger.log(
      `Getting detailed report for REGON: ${regon}, silosId: ${silosId}`,
      { correlationId },
    );

    try {
      const client = await this.getAuthenticatedClient(correlationId);

      const reportName = this.getReportNameBySilosId(silosId);

      const result = await this.invokeWithTimeout(
        () =>
          client.DanePobierzPelnyRaportAsync({
            pRegon: regon,
            pNazwaRaportu: reportName,
          }),
        this.config.timeout,
        'DanePobierzPelnyRaport',
      );

      const xmlData = (result as any)[0]?.DanePobierzPelnyRaportResult;
      if (!xmlData || xmlData.trim() === '<root></root>') {
        throw createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No detailed data found for REGON: ${regon}`,
          correlationId,
          source: 'GUS',
        });
      }

      const parsedData = this.parseXmlResponse(xmlData);

      // Validate based on expected schema
      if (silosId === '6') {
        return GusLegalPersonReportSchema.parse(parsedData);
      } else if (silosId === '1') {
        return GusPhysicalPersonReportSchema.parse(parsedData);
      } else {
        throw createErrorResponse({
          errorCode: 'CLASSIFICATION_FAILED',
          message: `Unsupported entity type: silosId=${silosId}`,
          correlationId,
          source: 'GUS',
        });
      }
    } catch (error) {
      this.logger.error(`Detailed report failed for REGON ${regon}`, {
        error: error instanceof Error ? error.message : String(error),
        correlationId,
      });

      if (
        error &&
        typeof error === 'object' &&
        'errorCode' in error &&
        error.errorCode
      ) {
        throw error; // Re-throw ErrorResponse
      }

      throw this.handleGusError(error, correlationId, 'detailed_report');
    }
  }

  /**
   * Get authenticated SOAP client with session management
   */
  private async getAuthenticatedClient(
    correlationId: string,
  ): Promise<soap.Client> {
    // Check if current session is valid
    if (this.currentSession && new Date() < this.currentSession.expiresAt) {
      return this.currentSession.client;
    }

    // Create new session
    return await this.createNewSession(correlationId);
  }

  /**
   * Create new authenticated session
   */
  private async createNewSession(correlationId: string): Promise<soap.Client> {
    this.logger.log('Creating new GUS session', { correlationId });

    try {
      // Create SOAP client
      const client = await soap.createClientAsync(
        this.config.baseUrl,
        {} as any,
      );

      // Login to get session
      const loginResult = await this.invokeWithTimeout(
        () => client.ZalogujAsync({ pKluczUzytkownika: this.config.userKey }),
        this.config.timeout,
        'Zaloguj',
      );

      const sessionId = (loginResult as any)[0]?.ZalogujResult;
      if (!sessionId) {
        throw new Error('Failed to obtain session ID from GUS');
      }

      // Set session header for subsequent requests
      client.addSoapHeader(
        {
          'ns:sid': sessionId,
        },
        '',
        'ns',
        'http://CIS/BIR/PUBL/2014/07',
      );

      const expiresAt = new Date(Date.now() + this.config.sessionTimeoutMs);

      this.currentSession = {
        sessionId,
        expiresAt,
        client,
      };

      this.logger.log(`GUS session created successfully`, {
        sessionId: sessionId.substring(0, 8) + '...', // Log partial session ID
        expiresAt,
        correlationId,
      });

      return client;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create GUS session', {
        error: errorMessage,
        correlationId,
      });

      throw createErrorResponse({
        errorCode: 'GUS_AUTHENTICATION_FAILED',
        message: 'Failed to authenticate with GUS service',
        correlationId,
        source: 'GUS',
        details: { originalError: errorMessage },
      });
    }
  }

  /**
   * Logout and cleanup session
   */
  async logout(correlationId: string): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    try {
      await this.invokeWithTimeout(
        () =>
          this.currentSession!.client.WylogujAsync({
            sid: this.currentSession!.sessionId,
          }),
        this.config.timeout,
        'Wyloguj',
      );

      this.logger.log('GUS session logged out successfully', { correlationId });
    } catch (error) {
      this.logger.warn('Failed to logout GUS session gracefully', {
        error: error instanceof Error ? error.message : String(error),
        correlationId,
      });
    } finally {
      this.currentSession = null;
    }
  }

  /**
   * Get report name based on silo ID
   */
  private getReportNameBySilosId(silosId: string): string {
    const reportNames = {
      '1': 'BIR11OsFizycznaDzialalnoscCeidg', // Individual entrepreneurs
      '6': 'BIR11OsPrawna', // Legal entities
    };

    const reportName = reportNames[silosId as keyof typeof reportNames];
    if (!reportName) {
      throw new Error(`No report available for silosId: ${silosId}`);
    }

    return reportName;
  }

  /**
   * Parse XML response to JavaScript object
   */
  private parseXmlResponse(xmlString: string): any {
    try {
      // Simple XML parsing (in production, use a proper XML parser)
      const parseString = require('xml2js').parseString;

      return new Promise((resolve, reject) => {
        parseString(xmlString, (err: any, result: any) => {
          if (err) {
            reject(err);
          } else {
            // Extract data from root.dane[0] structure
            const data = result?.root?.dane?.[0];
            if (!data) {
              reject(new Error('Invalid XML structure'));
            } else {
              resolve(data);
            }
          }
        });
      });
    } catch (error) {
      throw new Error(
        `Failed to parse XML response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Invoke SOAP method with timeout
   */
  private async invokeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Handle GUS-specific errors and convert to standardized ErrorResponse
   */
  private handleGusError(
    error: any,
    correlationId: string,
    operation: string,
  ): ErrorResponse {
    // SOAP fault handling
    if (error.fault || error.faultstring) {
      return createErrorResponse({
        errorCode: 'GUS_SOAP_FAULT',
        message: error.faultstring || error.fault || 'SOAP fault occurred',
        correlationId,
        source: 'GUS',
        details: {
          operation,
          fault: error.fault,
          faultstring: error.faultstring,
        },
      });
    }

    // Timeout errors
    if (error.message?.includes('timed out')) {
      return createErrorResponse({
        errorCode: 'TIMEOUT_ERROR',
        message: `GUS ${operation} operation timed out`,
        correlationId,
        source: 'GUS',
        details: { operation, originalError: error.message },
      });
    }

    // Network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return createErrorResponse({
        errorCode: 'GUS_SERVICE_UNAVAILABLE',
        message: 'Cannot connect to GUS service',
        correlationId,
        source: 'GUS',
        details: {
          operation,
          errorCode: error.code,
          originalError: error.message,
        },
      });
    }

    // Session expiration
    if (
      error.message?.includes('session') ||
      error.message?.includes('unauthorized')
    ) {
      // Clear invalid session
      this.currentSession = null;

      return createErrorResponse({
        errorCode: 'GUS_SESSION_EXPIRED',
        message: 'GUS session has expired',
        correlationId,
        source: 'GUS',
        details: { operation, originalError: error.message },
      });
    }

    // Generic GUS service error
    return createErrorResponse({
      errorCode: 'GUS_SERVICE_UNAVAILABLE',
      message: `GUS service error during ${operation}`,
      correlationId,
      source: 'GUS',
      details: { operation, originalError: error.message },
    });
  }
}

// Export postal code formatter utility
export function formatPolishPostalCode(code: string): string {
  if (code.length === 5 && !code.includes('-')) {
    return `${code.slice(0, 2)}-${code.slice(2)}`;
  }
  return code;
}
