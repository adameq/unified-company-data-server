import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { soap } from 'strong-soap';
import { z } from 'zod';
import { parseStringPromise } from 'xml2js';
import { stripPrefix } from 'xml2js/lib/processors';
import {
  createErrorResponse,
  type ErrorResponse,
} from '../../../schemas/error-response.schema';
import { type Environment } from '../../../config/environment.schema';
import { BusinessException } from '../../../common/exceptions/business-exceptions';

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

/**
 * Zaloguj (Login) response schema
 *
 * Background:
 * - GUS WSDL defines Zaloguj operation to return a string sessionId
 * - WSDL: https://wyszukiwarkaregon.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-prod.wsdl
 *
 * Response Structure:
 * The strong-soap library may return the sessionId in two formats:
 * 1. Direct string - when strong-soap unwraps single-value SOAP responses
 * 2. Object {ZalogujResult: string} - standard WSDL response structure
 *
 * Previous Implementation:
 * - Used defensive extraction trying 6+ different paths (ZalogujResult, zalogujresult, etc.)
 * - This was overly complex and indicated uncertainty about API contract
 *
 * Current Implementation:
 * - Uses Zod validation for type safety
 * - Supports only the two canonical response structures from strong-soap
 * - Logs response type for monitoring API behavior
 * - Fails fast with detailed error if unexpected structure is received
 *
 * Monitoring:
 * - Check logs for "responseType" field to track which format is used
 * - If validation fails, review zodErrors in logs to understand API changes
 */
export const ZalogujResponseSchema = z.union([
  z.string().min(20).describe('Session ID returned directly as string'),
  z.object({
    ZalogujResult: z.string().min(20).describe('Session ID in standard WSDL response object'),
  }).describe('Standard WSDL response with ZalogujResult field'),
]);

// Types inferred from schemas
export type GusClassificationResponse = z.infer<
  typeof GusClassificationResponseSchema
>;
export type GusLegalPersonReport = z.infer<typeof GusLegalPersonReportSchema>;
export type GusPhysicalPersonReport = z.infer<
  typeof GusPhysicalPersonReportSchema
>;
export type ZalogujResponse = z.infer<typeof ZalogujResponseSchema>;

// GUS service configuration
interface GusConfig {
  baseUrl: string;
  wsdlUrl: string;
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

  // Session refresh locking to prevent race conditions
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<soap.Client> | null = null;

  constructor(private readonly configService: ConfigService<Environment, true>) {
    this.config = {
      baseUrl: this.configService.get('GUS_BASE_URL', { infer: true }),
      wsdlUrl: this.configService.get('GUS_WSDL_URL', { infer: true }),
      userKey: this.configService.get('GUS_USER_KEY', { infer: true }),
      timeout: this.configService.get('EXTERNAL_API_TIMEOUT', { infer: true }),
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
      // Ensure we have a valid session
      await this.getAuthenticatedClient(correlationId);

      if (!this.currentSession) {
        throw new BusinessException({
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Internal error: No valid GUS session for classification request',
          correlationId,
          source: 'INTERNAL',
        });
      }

      // Normalize NIP (remove spaces)
      const cleanNip = nip.replace(/\s+/g, '').trim();

      // Add WS-Addressing headers for DaneSzukajPodmioty operation
      this.addWSAddressingHeaders(
        this.currentSession.client,
        'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty'
      );

      // CRITICAL: Re-add sid header before each operation (strong-soap may clear it)
      this.currentSession.client.clearHttpHeaders();
      this.currentSession.client.addHttpHeader('sid', this.currentSession.sessionId);

      this.logger.debug('Re-added sid header before DaneSzukajPodmioty', {
        sessionId: this.currentSession.sessionId.substring(0, 8) + '...',
        correlationId,
      });

      // Add small delay to avoid GUS rate limiting (required by GUS server)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Call DaneSzukajPodmioty operation using strong-soap
      // Simple flat structure - strong-soap will handle namespaces via WSDL
      const searchParams = {
        pParametryWyszukiwania: {
          Nip: cleanNip,
        },
      };

      this.logger.log('Calling DaneSzukajPodmioty operation', {
        nip: cleanNip,
        correlationId,
      });

      if (!this.currentSession?.client) {
        throw new BusinessException({
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Internal error: GUS session not initialized',
          correlationId,
          source: 'INTERNAL',
        });
      }

      const { result, envelope } = await new Promise<{ result: any; envelope: any }>(
        (resolve, reject) => {
          this.currentSession!.client.DaneSzukajPodmioty(
            searchParams,
            (err: Error | null, result: any, envelope: any) => {
              // Log actual SOAP request for debugging
              if (this.currentSession?.client.lastRequest) {
                this.logger.debug('DaneSzukajPodmioty SOAP Request', {
                  request: this.currentSession.client.lastRequest.substring(0, 1000),
                  correlationId,
                });
              }

              if (err) {
                this.logger.error('DaneSzukajPodmioty operation failed', {
                  error: err.message,
                  nip: cleanNip,
                  correlationId,
                });
                reject(err);
              } else {
                this.logger.log('DaneSzukajPodmioty operation succeeded', {
                  resultType: typeof result,
                  hasResult: !!result,
                  correlationId,
                });
                resolve({ result, envelope });
              }
            }
          );
        }
      );

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
      // Ensure we have a valid session
      await this.getAuthenticatedClient(correlationId);

      if (!this.currentSession) {
        throw new BusinessException({
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Internal error: No valid GUS session for detailed report request',
          correlationId,
          source: 'INTERNAL',
        });
      }

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

      // Add WS-Addressing headers for DanePobierzPelnyRaport operation
      this.addWSAddressingHeaders(
        this.currentSession.client,
        'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DanePobierzPelnyRaport'
      );

      // Add small delay to avoid GUS rate limiting (required by GUS server)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Call DanePobierzPelnyRaport operation using strong-soap
      const reportParams = {
        pRegon: cleanRegon,
        pNazwaRaportu: reportName,
      };

      this.logger.log('Calling DanePobierzPelnyRaport operation', {
        regon: cleanRegon,
        reportName,
        correlationId,
      });

      if (!this.currentSession?.client) {
        throw new BusinessException({
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Internal error: GUS session not initialized',
          correlationId,
          source: 'INTERNAL',
        });
      }

      const { result } = await new Promise<{ result: any; envelope: any }>(
        (resolve, reject) => {
          this.currentSession!.client.DanePobierzPelnyRaport(
            reportParams,
            (err: Error | null, result: any, envelope: any) => {
              // Log actual SOAP request for debugging
              if (this.currentSession?.client.lastRequest) {
                this.logger.debug('DanePobierzPelnyRaport SOAP Request', {
                  request: this.currentSession.client.lastRequest.substring(0, 1000),
                  correlationId,
                });
              }

              if (err) {
                this.logger.error('DanePobierzPelnyRaport operation failed', {
                  error: err.message,
                  regon: cleanRegon,
                  reportName,
                  correlationId,
                });
                reject(err);
              } else {
                this.logger.log('DanePobierzPelnyRaport operation succeeded', {
                  resultType: typeof result,
                  hasResult: !!result,
                  correlationId,
                });
                resolve({ result, envelope });
              }
            }
          );
        }
      );

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
   * Get authenticated SOAP client with session management
   *
   * Race condition protection:
   * - Uses isRefreshing flag to prevent concurrent session creation
   * - Queues concurrent requests to wait for ongoing session refresh
   * - Only one request creates new session, others reuse the same promise
   */
  private async getAuthenticatedClient(
    correlationId: string,
  ): Promise<soap.Client> {
    // Check if current session is valid
    if (this.currentSession && new Date() < this.currentSession.expiresAt) {
      return this.currentSession.client;
    }

    // If session refresh is already in progress, wait for it
    if (this.isRefreshing && this.refreshPromise) {
      this.logger.debug('Session refresh already in progress, waiting...', { correlationId });
      return this.refreshPromise;
    }

    // Start new session refresh with locking
    this.isRefreshing = true;
    this.refreshPromise = this.createNewSession(correlationId)
      .then((client) => {
        this.isRefreshing = false;
        this.refreshPromise = null;
        return client;
      })
      .catch((error) => {
        this.isRefreshing = false;
        this.refreshPromise = null;
        throw error;
      });

    return this.refreshPromise;
  }

  /**
   * Add WS-Addressing headers required by GUS API
   * Based on official GUS documentation (BIR11_Przyklady.pdf, page 5)
   *
   * Required format:
   * <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
   *   <wsa:To>endpoint</wsa:To>
   *   <wsa:Action>action</wsa:Action>
   * </soap:Header>
   *
   * Uses strong-soap's addSoapHeader() with XML string (recommended approach per Issue #84)
   * IMPORTANT: Each header element must be added separately (not as multi-element string)
   */
  private addWSAddressingHeaders(client: soap.Client, action: string): void {
    this.logger.debug('Adding WS-Addressing headers via addSoapHeader()', {
      action,
      to: this.config.baseUrl,
    });

    // Clear any existing SOAP headers
    client.clearSoapHeaders();

    // Add WS-Addressing headers as separate XML strings
    // This approach is recommended by strong-soap community (see GitHub Issue #84)
    // CRITICAL: Each header must be added separately to avoid XML parsing errors
    const wsaNamespace = 'http://www.w3.org/2005/08/addressing';

    // XML string overload now properly typed in strong-soap.d.ts
    client.addSoapHeader(`<wsa:To xmlns:wsa="${wsaNamespace}">${this.config.baseUrl}</wsa:To>`);
    client.addSoapHeader(`<wsa:Action xmlns:wsa="${wsaNamespace}">${action}</wsa:Action>`);

    this.logger.debug('WS-Addressing headers added successfully', {
      action,
      to: this.config.baseUrl,
      method: 'addSoapHeader(xmlString) - separate elements',
    });
  }


  /**
   * Create new authenticated session using strong-soap
   */
  private async createNewSession(correlationId: string): Promise<soap.Client> {
    this.logger.log('Creating new GUS session with strong-soap', {
      correlationId,
    });

    try {
      // Step 1: Create strong-soap client from WSDL
      const client = await new Promise<soap.Client>((resolve, reject) => {
        soap.createClient(this.config.wsdlUrl, {
          endpoint: this.config.baseUrl,
          wsdl_options: {
            timeout: this.config.timeout,
          },
        }, (err: Error | null, client: soap.Client) => {
          if (err) reject(err);
          else resolve(client);
        });
      });

      // Set the endpoint explicitly
      client.setEndpoint(this.config.baseUrl);

      this.logger.log('strong-soap client created from WSDL', {
        endpoint: this.config.baseUrl,
        correlationId,
      });


      // Step 3: Add WS-Addressing SOAP headers required by GUS API
      this.addWSAddressingHeaders(
        client,
        'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj'
      );

      // Step 4: Perform login using Zaloguj operation with options to see request
      const loginResult = await new Promise<any>((resolve, reject) => {
        // Add request interceptor using options parameter
        const options = {
          // This will be passed as 4th parameter to capture request
        };

        client.Zaloguj(
          { pKluczUzytkownika: this.config.userKey },
          (err: Error | null, result: any, envelope: any, soapHeader: any) => {
            // CRITICAL: Log the actual SOAP request being sent
            if (client.lastRequest) {
              this.logger.debug('Zaloguj SOAP Request (first 1200 chars)', {
                request: client.lastRequest.substring(0, 1200),
                correlationId,
              });
            }

            // Always log request and response for debugging
            this.logger.debug('Zaloguj callback invoked', {
              hasError: !!err,
              errorMessage: err ? err.message : 'N/A',
              resultType: typeof result,
              resultValue: JSON.stringify(result),
              envelopeType: typeof envelope,
              envelopeValue: envelope ? JSON.stringify(envelope).substring(0, 500) : 'N/A',
              lastResponse: client.lastResponse ? client.lastResponse.substring(0, 800) : 'N/A',
              correlationId,
            });

            if (err) {
              this.logger.warn('Zaloguj operation failed', {
                error: err.message,
                lastRequest: client.lastRequest ? client.lastRequest.substring(0, 1200) : 'N/A',
                lastResponse: client.lastResponse ? client.lastResponse.substring(0, 1200) : 'N/A',
                correlationId,
              });
              reject(err);
            } else {
              this.logger.debug('Zaloguj operation completed successfully', {
                resultIsNull: result === null,
                correlationId,
              });
              resolve(result);
            }
          },
          options
        );
      });

      // Validate and extract session ID using Zod schema
      // This replaces the previous defensive extraction logic with type-safe validation
      const validation = ZalogujResponseSchema.safeParse(loginResult);

      if (!validation.success) {
        // Log detailed information about unexpected response structure
        this.logger.error('Zaloguj response failed schema validation', {
          loginResultType: typeof loginResult,
          loginResultValue: JSON.stringify(loginResult),
          loginResultKeys: typeof loginResult === 'object' && loginResult !== null ? Object.keys(loginResult) : 'N/A',
          zodErrors: validation.error.issues,
          correlationId,
        });

        throw new BusinessException({
          errorCode: 'GUS_INVALID_RESPONSE',
          message: 'GUS API returned unexpected Zaloguj response structure. Expected string or {ZalogujResult: string}.',
          correlationId,
          source: 'GUS',
          details: {
            zodErrors: validation.error.issues,
            responseStructure: typeof loginResult === 'object' && loginResult !== null
              ? Object.keys(loginResult)
              : typeof loginResult,
          },
        });
      }

      // Extract sessionId from validated response
      const sessionId = typeof validation.data === 'string'
        ? validation.data
        : validation.data.ZalogujResult;

      // Log which response structure was used (for monitoring API behavior)
      const responseType = typeof validation.data === 'string' ? 'direct-string' : 'ZalogujResult-object';
      this.logger.debug('Session ID extracted from Zaloguj response', {
        responseType,
        sessionIdLength: sessionId.length,
        correlationId,
      });

      this.logger.log('Session ID extracted successfully', {
        sessionIdLength: sessionId.length,
        sessionIdPrefix: sessionId.substring(0, 8) + '...',
        correlationId,
      });

      // Step 3: Add session ID as HTTP header for all subsequent requests
      client.addHttpHeader('sid', sessionId);

      // Also store in client for interceptor fallback (now properly typed)
      client._sessionId = sessionId;

      this.logger.log('HTTP header "sid" added to client', {
        sessionIdStored: true,
        correlationId,
      });

      // Store session information
      const expiresAt = new Date(Date.now() + this.config.sessionTimeoutMs);

      this.currentSession = {
        sessionId,
        expiresAt,
        client,
      };

      this.logger.log('GUS session created successfully with strong-soap', {
        sessionId: sessionId.substring(0, 8) + '...',
        expiresAt,
        correlationId,
      });

      return client;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create GUS session with strong-soap', {
        error: errorMessage,
        correlationId,
      });

      throw createErrorResponse({
        errorCode: 'GUS_AUTHENTICATION_FAILED',
        message: 'Failed to authenticate with GUS service using strong-soap',
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

    const session = this.currentSession; // Capture for TypeScript type narrowing

    try {
      // Add WS-Addressing headers for Wyloguj operation
      this.addWSAddressingHeaders(
        session.client,
        'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Wyloguj'
      );

      // Call Wyloguj operation using strong-soap
      await new Promise<void>((resolve, reject) => {
        session.client.Wyloguj(
          { pIdentyfikatorSesji: session.sessionId },
          (err: Error | null) => {
            if (err) {
              this.logger.warn('Wyloguj operation failed', {
                error: err.message,
                correlationId,
              });
              // Don't reject - logout is best-effort
              resolve();
            } else {
              this.logger.log('GUS session logged out successfully', { correlationId });
              resolve();
            }
          }
        );
      });
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
      this.currentSession = null;

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
      this.currentSession = null;

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
      this.currentSession = null;

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
      // Health check: Just verify we can create SOAP client from WSDL
      // This confirms the service is responding and WSDL is accessible
      const client = await Promise.race<soap.Client>([
        new Promise<soap.Client>((resolve, reject) => {
          soap.createClient(
            this.config.wsdlUrl,
            {
              endpoint: this.config.baseUrl,
              wsdl_options: {
                timeout: 5000,
              },
            },
            (err: Error | null, client: soap.Client) => {
              if (err) reject(err);
              else resolve(client);
            },
          );
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
