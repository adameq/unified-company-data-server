import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { soap } from 'strong-soap';
import { z } from 'zod';
import { parseStringPromise } from 'xml2js';
import { stripPrefix } from 'xml2js/lib/processors';
import {
  createErrorResponse,
  type ErrorResponse,
} from '@schemas/error-response.schema';
import { type Environment } from '@config/environment.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import { GusSessionManager } from './gus-session.manager';
import { GusRequestInterceptor } from './gus-request.interceptor';
import { GusRateLimiterService } from './gus-rate-limiter.service';
import { GusSession, GusConfig } from './interfaces/gus-session.interface';
import {
  createSoapClient,
  callSoapOperation,
} from './gus-soap.helpers';

/**
 * GUS SOAP Service for Polish Statistical Office API
 *
 * Handles:
 * - Session-based authentication with 30-minute timeout
 * - Company classification via DaneSzukajPodmioty
 * - Detailed reports via DanePobierzPelnyRaport
 * - SOAP fault handling and error recovery
 *
 * Retry Strategy:
 * - Service-level retry is NOT implemented (methods throw errors directly)
 * - Retry logic is handled by orchestration.machine.ts using retry.machine.ts
 * - Configuration: GUS_MAX_RETRIES (default 2), GUS_INITIAL_DELAY (default 100ms)
 * - Retries on: 5xx server errors, session errors (SESSION_EXPIRED, SESSION_ERROR)
 * - No retry on: 404 Not Found, validation errors
 * - Exponential backoff with jitter managed by retry.machine.ts
 * - Session recovery: On session errors, new session is created before retry
 *
 * Constitutional compliance:
 * - All responses validated with Zod schemas
 * - Defensive programming against SOAP faults
 * - Structured logging with correlation IDs
 * - Timeout and retry handling via state machines
 */

// GUS API operation schemas for validation
export const GusClassificationResponseSchema = z.object({
  Regon: z.string().regex(/^\d{9}(\d{5})?$/),
  Nip: z.string().regex(/^\d{10}$/),
  Nazwa: z.string(),
  Typ: z.string(),
  SilosID: z.enum(['1', '2', '4', '6']),
  Wojewodztwo: z.string().optional(),
  Powiat: z.string().optional(),
  Gmina: z.string().optional(),
  Miejscowosc: z.string().optional(),
  KodPocztowy: z.string().optional(),
  Ulica: z.string().optional(),
  NrNieruchomosci: z.string().optional(),
  NrLokalu: z.string().optional(),
  DataZakonczeniaDzialalnosci: z.string().optional(),
  MiejscowoscPoczty: z.string().optional(),
});

export const GusLegalPersonReportSchema = z.object({
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

export const GusPhysicalPersonReportSchema = z.object({
  fiz_regon9: z.string(),
  fiz_nip: z.string().optional(),
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

@Injectable()
export class GusService {
  private readonly logger = new Logger(GusService.name);
  private readonly config: GusConfig;
  private readonly sessionManager: GusSessionManager;
  private readonly requestInterceptor: GusRequestInterceptor;

  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly rateLimiter: GusRateLimiterService,
  ) {
    this.config = {
      baseUrl: this.configService.get('GUS_BASE_URL', { infer: true }),
      wsdlUrl: this.configService.get('GUS_WSDL_URL', { infer: true }),
      userKey: this.configService.get('GUS_USER_KEY', { infer: true }),
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    };

    // Initialize session manager and request interceptor
    this.sessionManager = new GusSessionManager(this.config);
    this.requestInterceptor = new GusRequestInterceptor(
      this.sessionManager,
      this.config,
    );
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
      // Get active session (will be created if expired)
      const session = await this.sessionManager.getSession(correlationId);

      // Attach interceptor to add headers automatically
      this.requestInterceptor.attach(session.client, 'DaneSzukajPodmioty');

      // Normalize NIP (remove spaces)
      const cleanNip = nip.replace(/\s+/g, '').trim();

      // Rate limiting: Ensure we don't exceed GUS API rate limits
      // Uses Bottleneck token bucket algorithm to queue concurrent requests
      await this.rateLimiter.schedule(() => Promise.resolve());

      // Call DaneSzukajPodmioty operation using strong-soap
      // Headers (sid, WS-Addressing) are added automatically by GusRequestInterceptor
      const searchParams = {
        pParametryWyszukiwania: {
          Nip: cleanNip,
        },
      };

      this.logger.log('Calling DaneSzukajPodmioty operation', {
        nip: cleanNip,
        correlationId,
      });

      // Call DaneSzukajPodmioty using promisified helper
      const { result, envelope } = await callSoapOperation(
        session.client.DaneSzukajPodmioty,
        searchParams,
        session.client,
      ).catch((err: Error) => {
        this.logger.error('DaneSzukajPodmioty operation failed', {
          error: err.message,
          nip: cleanNip,
          correlationId,
        });
        throw err;
      });

      // Log actual SOAP request for debugging
      if (session.client.lastRequest) {
        this.logger.debug('DaneSzukajPodmioty SOAP Request', {
          request: session.client.lastRequest.substring(0, 1000),
          correlationId,
        });
      }

      this.logger.log('DaneSzukajPodmioty operation succeeded', {
        resultType: typeof result,
        hasResult: !!result,
        correlationId,
      });

      // Extract XML data from SOAP result
      // strong-soap returns the operation result directly
      const xmlData = result?.DaneSzukajPodmiotyResult || result?.daneszszukajpodmiotyresult || null;

      if (
        !xmlData ||
        xmlData.trim() === '<root></root>' ||
        xmlData.trim() === ''
      ) {
        const errorResponse = createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No entity found for NIP: ${nip}`,
          correlationId,
          source: 'GUS',
        });
        throw new BusinessException(errorResponse);
      }

      // Check for GUS error responses before parsing
      if (xmlData.includes('<ErrorCode>')) {
        const parsedError = await this.parseXmlResponse(xmlData, correlationId);

        // Handle different GUS error codes
        const errorCode =
          parsedError?.dane?.ErrorCode || parsedError?.ErrorCode;
        const errorMessage =
          parsedError?.dane?.ErrorMessagePl ||
          parsedError?.ErrorMessagePl ||
          'Unknown GUS error';

        if (errorCode === '4') {
          const errorResponse = createErrorResponse({
            errorCode: 'ENTITY_NOT_FOUND',
            message: `No entity found for NIP: ${nip}`,
            correlationId,
            source: 'GUS',
            details: { gusErrorCode: errorCode, gusErrorMessage: errorMessage },
          });
          throw new BusinessException(errorResponse);
        }

        // Handle other GUS errors
        const errorResponse = createErrorResponse({
          errorCode: 'GUS_SERVICE_UNAVAILABLE',
          message: `GUS service error: ${errorMessage}`,
          correlationId,
          source: 'GUS',
          details: { gusErrorCode: errorCode, gusErrorMessage: errorMessage },
        });
        throw new BusinessException(errorResponse);
      }

      const parsedData = await this.parseXmlResponse(xmlData, correlationId);

      // Validate response with Zod using safeParse
      const validation = GusClassificationResponseSchema.safeParse(parsedData);
      if (!validation.success) {
        this.logger.error(`GUS classification response failed schema validation`, {
          correlationId,
          nip,
          zodErrors: validation.error.issues,
          dataPreview: JSON.stringify(parsedData).substring(0, 500),
        });

        const errorResponse = createErrorResponse({
          errorCode: 'GUS_VALIDATION_FAILED',
          message: 'GUS classification response failed schema validation',
          correlationId,
          source: 'GUS',
          details: {
            zodErrors: validation.error.issues,
            nip,
          },
        });
        throw new BusinessException(errorResponse);
      }

      const classificationData = validation.data;

      this.logger.log(
        `Classification found: silosId=${classificationData.SilosID}`,
        { correlationId },
      );

      return classificationData;
    } catch (error) {
      this.logger.error(`Classification failed for NIP ${nip}`, {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
        correlationId,
      });

      // Re-throw BusinessException as-is
      if (error instanceof BusinessException) {
        throw error;
      }

      // Convert other errors to BusinessException
      const errorResponse = this.handleGusError(error, correlationId, 'classification');
      throw new BusinessException(errorResponse);
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
      // Get active session (will be created if expired)
      const session = await this.sessionManager.getSession(correlationId);

      // Attach interceptor to add headers automatically
      this.requestInterceptor.attach(session.client, 'DanePobierzPelnyRaport');

      // Validate and normalize REGON
      const cleanRegon = regon.replace(/\s+/g, '').trim();
      if (!/^\d{9}(\d{5})?$/.test(cleanRegon)) {
        throw createErrorResponse({
          errorCode: 'INVALID_REQUEST_FORMAT',
          message: `Invalid REGON format: ${regon}. Expected 9 or 14 digits.`,
          correlationId,
          source: 'INTERNAL',
        });
      }

      const reportName = this.getReportNameBySilosId(silosId, correlationId);

      // Rate limiting: Ensure we don't exceed GUS API rate limits
      // Uses Bottleneck token bucket algorithm to queue concurrent requests
      await this.rateLimiter.schedule(() => Promise.resolve());

      // Call DanePobierzPelnyRaport operation using strong-soap
      // Headers (sid, WS-Addressing) are added automatically by GusRequestInterceptor
      const reportParams = {
        pRegon: cleanRegon,
        pNazwaRaportu: reportName,
      };

      this.logger.log('Calling DanePobierzPelnyRaport operation', {
        regon: cleanRegon,
        reportName,
        correlationId,
      });

      // Call DanePobierzPelnyRaport using promisified helper
      const { result } = await callSoapOperation(
        session.client.DanePobierzPelnyRaport,
        reportParams,
        session.client,
      ).catch((err: Error) => {
        this.logger.error('DanePobierzPelnyRaport operation failed', {
          error: err.message,
          regon: cleanRegon,
          reportName,
          correlationId,
        });
        throw err;
      });

      // Log actual SOAP request for debugging
      if (session.client.lastRequest) {
        this.logger.debug('DanePobierzPelnyRaport SOAP Request', {
          request: session.client.lastRequest.substring(0, 1000),
          correlationId,
        });
      }

      this.logger.log('DanePobierzPelnyRaport operation succeeded', {
        resultType: typeof result,
        hasResult: !!result,
        correlationId,
      });

      // Extract XML data from SOAP result
      const xmlData = result?.DanePobierzPelnyRaportResult || result?.danepobierzpelnyraportresult || null;

      this.logger.log(`Extracted detailed report data for REGON ${regon}`, {
        xmlDataLength: xmlData ? xmlData.length : 0,
        correlationId,
      });

      if (
        !xmlData ||
        xmlData.trim() === '<root></root>' ||
        xmlData.trim() === ''
      ) {
        const errorResponse = createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No detailed data found for REGON: ${regon}`,
          correlationId,
          source: 'GUS',
        });
        throw new BusinessException(errorResponse);
      }

      const parsedData = await this.parseXmlResponse(xmlData, correlationId);

      // Validate based on expected schema using safeParse
      if (silosId === '6') {
        const validation = GusLegalPersonReportSchema.safeParse(parsedData);
        if (!validation.success) {
          this.logger.error(`GUS legal person report failed schema validation`, {
            correlationId,
            regon,
            silosId,
            zodErrors: validation.error.issues,
            dataPreview: JSON.stringify(parsedData).substring(0, 500),
          });

          const errorResponse = createErrorResponse({
            errorCode: 'GUS_VALIDATION_FAILED',
            message: 'GUS legal person report failed schema validation',
            correlationId,
            source: 'GUS',
            details: {
              zodErrors: validation.error.issues,
              regon,
              silosId,
            },
          });
          throw new BusinessException(errorResponse);
        }
        return validation.data;
      } else if (silosId === '1') {
        const validation = GusPhysicalPersonReportSchema.safeParse(parsedData);
        if (!validation.success) {
          this.logger.error(`GUS physical person report failed schema validation`, {
            correlationId,
            regon,
            silosId,
            zodErrors: validation.error.issues,
            dataPreview: JSON.stringify(parsedData).substring(0, 500),
          });

          const errorResponse = createErrorResponse({
            errorCode: 'GUS_VALIDATION_FAILED',
            message: 'GUS physical person report failed schema validation',
            correlationId,
            source: 'GUS',
            details: {
              zodErrors: validation.error.issues,
              regon,
              silosId,
            },
          });
          throw new BusinessException(errorResponse);
        }
        return validation.data;
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
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : error,
        correlationId,
      });

      // Re-throw BusinessException as-is
      if (error instanceof BusinessException) {
        throw error;
      }

      // Convert other errors to BusinessException
      const errorResponse = this.handleGusError(error, correlationId, 'detailed_report');
      throw new BusinessException(errorResponse);
    }
  }

  /**
   * Logout and cleanup session
   *
   * Delegates to GusSessionManager for session management.
   * Headers are added automatically by GusRequestInterceptor.
   */
  async logout(correlationId: string): Promise<void> {
    await this.sessionManager.logout(correlationId);
  }

  /**
   * Get report name based on silo ID
   */
  private getReportNameBySilosId(silosId: string, correlationId?: string): string {
    const reportNames = {
      '1': 'BIR11OsFizycznaDzialalnoscCeidg', // Individual entrepreneurs
      '6': 'BIR11OsPrawna', // Legal entities
    };

    const reportName = reportNames[silosId as keyof typeof reportNames];
    if (!reportName) {
      throw new BusinessException({
        errorCode: 'GUS_SERVICE_UNAVAILABLE',
        message: `GUS API error: No report available for silosId: ${silosId}`,
        correlationId: correlationId || `gus-${Date.now()}`,
        source: 'GUS',
        details: { silosId },
      });
    }

    return reportName;
  }

  /**
   * Parse XML response to JavaScript object (inner XML data from GUS)
   */
  private async parseXmlResponse(xmlString: string, correlationId?: string): Promise<any> {
    try {
      const parsed = await parseStringPromise(xmlString, {
        explicitArray: false,
        tagNameProcessors: [stripPrefix],
        attrNameProcessors: [stripPrefix],
        normalize: true,
        trim: true,
      });

      // Extract data from root.dane[0] structure (GUS specific format)
      const data = parsed?.root?.dane;
      if (!data) {
        throw new BusinessException({
          errorCode: 'GUS_SERVICE_UNAVAILABLE',
          message: 'GUS API error: Invalid XML structure - missing root.dane',
          correlationId: correlationId || `gus-${Date.now()}`,
          source: 'GUS',
        });
      }

      // If dane is an array, take the first element; otherwise use it directly
      return Array.isArray(data) ? data[0] : data;
    } catch (error) {
      this.logger.error('Failed to parse GUS XML response', {
        error: error instanceof Error ? error.message : String(error),
        xmlLength: xmlString.length,
        xmlSnippet: xmlString.substring(0, 200),
      });
      throw new Error(
        `Failed to parse GUS XML response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle GUS-specific errors and convert to standardized ErrorResponse
   */
  private handleGusError(
    error: any,
    correlationId: string,
    operation: string,
  ): ErrorResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);

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

    // Handle XML deserialization errors from GUS (common with bad XML formatting)
    if (
      errorMessage.includes('DeserializationFailed') ||
      errorMessage.includes('Error in line') ||
      errorMessage.includes('Expecting state') ||
      errorMessage.includes("Encountered 'CDATA'") ||
      errorMessage.includes("Encountered 'Text'")
    ) {
      return createErrorResponse({
        errorCode: 'GUS_SOAP_FAULT',
        message: 'GUS API rejected XML request due to formatting issues',
        correlationId,
        source: 'GUS',
        details: {
          operation,
          originalError: errorMessage,
          hint: 'Check XML element formatting and CDATA usage',
        },
      });
    }

    // GUS API-specific error codes (from BIR documentation)
    // Error codes 1, 2, 7 indicate session problems
    if (
      errorMessage.includes('Błąd') ||
      errorMessage.includes('Error') ||
      errorMessage.includes('kod=1') || // Błąd ogólny
      errorMessage.includes('kod=2') || // Brak sesji lub sesja wygasła
      errorMessage.includes('kod=7') // Nieprawidłowy identyfikator sesji
    ) {
      // Clear invalid session
      this.sessionManager.clearSession();

      return createErrorResponse({
        errorCode: 'GUS_SESSION_EXPIRED',
        message: 'GUS session has expired or is invalid',
        correlationId,
        source: 'GUS',
        details: { operation, originalError: errorMessage },
      });
    }

    // HTTP 401 Unauthorized - session problems
    if (error.response?.status === 401 || errorMessage.includes('401')) {
      this.sessionManager.clearSession();

      return createErrorResponse({
        errorCode: 'GUS_SESSION_EXPIRED',
        message: 'GUS session unauthorized',
        correlationId,
        source: 'GUS',
        details: { operation, originalError: errorMessage },
      });
    }

    // Timeout errors
    if (
      errorMessage.includes('timed out') ||
      errorMessage.includes('timeout')
    ) {
      return createErrorResponse({
        errorCode: 'TIMEOUT_ERROR',
        message: `GUS ${operation} operation timed out`,
        correlationId,
        source: 'GUS',
        details: { operation, originalError: errorMessage },
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
          originalError: errorMessage,
        },
      });
    }

    // Generic session expiration patterns
    if (
      errorMessage.includes('session') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('sid')
    ) {
      // Clear invalid session
      this.sessionManager.clearSession();

      return createErrorResponse({
        errorCode: 'GUS_SESSION_EXPIRED',
        message: 'GUS session has expired',
        correlationId,
        source: 'GUS',
        details: { operation, originalError: errorMessage },
      });
    }

    // Generic GUS service error
    return createErrorResponse({
      errorCode: 'GUS_SERVICE_UNAVAILABLE',
      message: `GUS service error during ${operation}`,
      correlationId,
      source: 'GUS',
      details: { operation, originalError: errorMessage },
    });
  }

  /**
   * Health check for GUS SOAP API
   * Uses GetValue operation with StatusUslugi parameter to verify service availability
   *
   * Implementation uses strong-soap client (consistent with other GUS operations).
   * We accept both successful responses AND SOAP faults as "healthy" -
   * what matters is that the service responded (not network timeout/connection error).
   *
   * @returns Promise<'healthy' | 'unhealthy'>
   */
  async checkHealth(): Promise<'healthy' | 'unhealthy'> {
    try {
      // Health check: Just verify we can create SOAP client from WSDL (using promisified helper)
      // This confirms the service is responding and WSDL is accessible
      const client = await Promise.race<soap.Client>([
        createSoapClient(this.config.wsdlUrl, {
          endpoint: this.config.baseUrl,
          wsdl_options: {
            timeout: 5000,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Client creation timeout')), 5000),
        ),
      ]);

      // If we got here, WSDL is accessible and client was created successfully
      // This means GUS service is responding
      this.logger.log('GUS health check successful (WSDL accessible, service responding)');
      return 'healthy';
    } catch (error) {
      this.logger.warn('GUS health check failed (service unreachable)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unhealthy';
    }
  }

}

// Export postal code formatter utility
export function formatPolishPostalCode(code: string): string {
  // Only format if exactly 5 digits (no dash)
  if (code.length === 5 && !code.includes('-') && /^\d{5}$/.test(code)) {
    return `${code.slice(0, 2)}-${code.slice(2)}`;
  }
  return code;
}
