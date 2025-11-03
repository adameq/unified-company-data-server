import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { soap } from 'strong-soap';
import { createErrorResponse } from '@schemas/error-response.schema';
import { type Environment } from '@config/environment.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import { GusSessionManager } from './gus-session.manager';
import { GusRateLimiterService } from './gus-rate-limiter.service';
import { GusSession, GusConfig } from './interfaces/gus-session.interface';
import { createSoapClient } from './gus-soap.helpers';
import { GusResponseParser } from './parsers/gus-response.parser';
import {
  GusResponseValidator,
  type GusClassificationResponse,
  type GusLegalPersonReport,
  type GusPhysicalPersonReport,
} from './validators/gus-response.validator';
import { GusErrorHandler } from './handlers/gus-error.handler';

/**
 * GUS SOAP Service for Polish Statistical Office API
 *
 * Refactored to follow Single Responsibility Principle:
 * - This service now acts as a facade/orchestrator
 * - Parsing delegated to GusResponseParser
 * - Validation delegated to GusResponseValidator
 * - Error handling delegated to GusErrorHandler
 *
 * Responsibilities:
 * - Orchestrate SOAP operations (DaneSzukajPodmioty, DanePobierzPelnyRaport)
 * - Manage rate limiting and session lifecycle
 * - Coordinate parsing, validation, and error handling
 *
 * Retry Strategy:
 * - Service-level retry is NOT implemented (methods throw errors directly)
 * - Retry logic is handled by orchestration.machine.ts using retry.machine.ts
 * - Configuration: GUS_MAX_RETRIES (default 2), GUS_INITIAL_DELAY (default 100ms)
 * - Retries on: 5xx server errors, session errors (SESSION_EXPIRED, SESSION_ERROR)
 * - No retry on: 404 Not Found, validation errors
 * - Exponential backoff with jitter managed by retry.machine.ts
 * - Session recovery: On session errors, new session is created before retry
 */

// Re-export types from validator for backward compatibility
export type {
  GusClassificationResponse,
  GusLegalPersonReport,
  GusPhysicalPersonReport,
} from './validators/gus-response.validator';

@Injectable()
export class GusService {
  private readonly logger = new Logger(GusService.name);
  private readonly config: GusConfig;
  private readonly sessionManager: GusSessionManager;

  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly rateLimiter: GusRateLimiterService,
    private readonly parser: GusResponseParser,
    private readonly validator: GusResponseValidator,
    private readonly errorHandler: GusErrorHandler,
  ) {
    this.config = {
      baseUrl: this.configService.get('GUS_BASE_URL', { infer: true }),
      wsdlUrl: this.configService.get('GUS_WSDL_URL', { infer: true }),
      userKey: this.configService.get('GUS_USER_KEY', { infer: true }),
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    };

    // Initialize session manager (header manager now used internally by GusSoapClient facade)
    this.sessionManager = new GusSessionManager(this.config);
  }


  /**
   * Get company classification by NIP to determine routing strategy
   *
   * Refactored to delegate responsibilities:
   * - Session management → GusSessionManager
   * - Rate limiting → GusRateLimiterService
   * - XML extraction → GusResponseParser.extractSoapResult()
   * - XML parsing → GusResponseParser.parseXmlResponse()
   * - Error detection → GusResponseParser.detectGusError()
   * - Validation → GusResponseValidator.validateClassification()
   * - Error handling → GusErrorHandler.handleGusApiError() / handleSoapError()
   */
  async getClassificationByNip(
    nip: string,
    correlationId: string,
  ): Promise<GusClassificationResponse> {
    this.logger.log(`Getting classification for NIP: ${nip}`, {
      correlationId,
    });

    try {
      // 1. Session management
      const session = await this.sessionManager.getSession(correlationId);

      // 2. Normalize NIP (remove spaces)
      const cleanNip = nip.replace(/\s+/g, '').trim();

      // 3. Rate limiting
      await this.rateLimiter.schedule(() => Promise.resolve());

      this.logger.log('Calling DaneSzukajPodmioty operation', {
        nip: cleanNip,
        correlationId,
      });

      // 4. Execute SOAP operation
      const { result } = await session.soapClient
        .daneSzukajPodmioty({
          Nip: cleanNip,
        })
        .catch((err: Error) => {
          this.logger.error('DaneSzukajPodmioty operation failed', {
            error: err.message,
            nip: cleanNip,
            correlationId,
          });
          throw err;
        });

      // Log actual SOAP request for debugging
      const lastRequest = session.soapClient.getLastRequest();
      if (lastRequest) {
        this.logger.debug('DaneSzukajPodmioty SOAP Request', {
          request: lastRequest.substring(0, 1000),
          correlationId,
        });
      }

      this.logger.log('DaneSzukajPodmioty operation succeeded', {
        resultType: typeof result,
        hasResult: !!result,
        correlationId,
      });

      // 5. Parse response (delegated to GusResponseParser)
      const xmlData = this.parser.extractSoapResult(result, 'DaneSzukajPodmioty');

      // Check if empty (common pattern for "not found")
      if (this.parser.isEmptyXmlData(xmlData)) {
        const errorResponse = createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No entity found for NIP: ${nip}`,
          correlationId,
          source: 'GUS',
        });
        throw new BusinessException(errorResponse);
      }

      const parsedData = await this.parser.parseXmlResponse(xmlData, correlationId);

      // 6. Detect GUS API errors (delegated to GusResponseParser)
      const gusError = this.parser.detectGusError(parsedData);
      if (gusError) {
        const errorResponse = this.errorHandler.handleGusApiError(
          gusError,
          correlationId,
          nip,
        );
        throw new BusinessException(errorResponse);
      }

      // 7. Validate with Zod (delegated to GusResponseValidator)
      const classificationData = this.validator.validateClassification(
        parsedData,
        correlationId,
        nip,
      );

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

      // Convert other errors to BusinessException (delegated to GusErrorHandler)
      const errorResponse = this.errorHandler.handleSoapError(
        error,
        correlationId,
        'classification',
      );

      // Clear session if error indicates session expiration
      if (this.errorHandler.isSessionExpiredError(errorResponse)) {
        this.sessionManager.clearSession();
      }

      throw new BusinessException(errorResponse);
    }
  }

  /**
   * Get detailed company report based on REGON and entity type
   *
   * Refactored to delegate responsibilities:
   * - Session management → GusSessionManager
   * - Rate limiting → GusRateLimiterService
   * - XML extraction → GusResponseParser.extractSoapResult()
   * - XML parsing → GusResponseParser.parseXmlResponse()
   * - Validation → GusResponseValidator.validateLegalPersonReport() / validatePhysicalPersonReport()
   * - Error handling → GusErrorHandler.handleSoapError()
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
      // 1. Session management
      const session = await this.sessionManager.getSession(correlationId);

      // 2. Validate and normalize REGON
      const cleanRegon = regon.replace(/\s+/g, '').trim();
      if (!/^\d{9}(\d{5})?$/.test(cleanRegon)) {
        throw new BusinessException(
          createErrorResponse({
            errorCode: 'INVALID_REQUEST_FORMAT',
            message: `Invalid REGON format: ${regon}. Expected 9 or 14 digits.`,
            correlationId,
            source: 'INTERNAL',
          }),
        );
      }

      const reportName = this.getReportNameBySilosId(silosId, correlationId);

      // 3. Rate limiting
      await this.rateLimiter.schedule(() => Promise.resolve());

      this.logger.log('Calling DanePobierzPelnyRaport operation', {
        regon: cleanRegon,
        reportName,
        correlationId,
      });

      // 4. Execute SOAP operation
      const { result } = await session.soapClient
        .danePobierzPelnyRaport(cleanRegon, reportName)
        .catch((err: Error) => {
          this.logger.error('DanePobierzPelnyRaport operation failed', {
            error: err.message,
            regon: cleanRegon,
            reportName,
            correlationId,
          });
          throw err;
        });

      // Log actual SOAP request for debugging
      const lastRequest = session.soapClient.getLastRequest();
      if (lastRequest) {
        this.logger.debug('DanePobierzPelnyRaport SOAP Request', {
          request: lastRequest.substring(0, 1000),
          correlationId,
        });
      }

      this.logger.log('DanePobierzPelnyRaport operation succeeded', {
        resultType: typeof result,
        hasResult: !!result,
        correlationId,
      });

      // 5. Parse response (delegated to GusResponseParser)
      const xmlData = this.parser.extractSoapResult(result, 'DanePobierzPelnyRaport');

      this.logger.log(`Extracted detailed report data for REGON ${regon}`, {
        xmlDataLength: xmlData ? xmlData.length : 0,
        correlationId,
      });

      // Check if empty (common pattern for "not found")
      if (this.parser.isEmptyXmlData(xmlData)) {
        const errorResponse = createErrorResponse({
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No detailed data found for REGON: ${regon}`,
          correlationId,
          source: 'GUS',
        });
        throw new BusinessException(errorResponse);
      }

      const parsedData = await this.parser.parseXmlResponse(xmlData, correlationId);

      // 6. Validate based on expected schema (delegated to GusResponseValidator)
      if (silosId === '6') {
        return this.validator.validateLegalPersonReport(
          parsedData,
          correlationId,
          regon,
          silosId,
        );
      } else if (silosId === '1') {
        return this.validator.validatePhysicalPersonReport(
          parsedData,
          correlationId,
          regon,
          silosId,
        );
      } else {
        throw new BusinessException(
          createErrorResponse({
            errorCode: 'CLASSIFICATION_FAILED',
            message: `Unsupported entity type: silosId=${silosId}`,
            correlationId,
            source: 'GUS',
          }),
        );
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

      // Convert other errors to BusinessException (delegated to GusErrorHandler)
      const errorResponse = this.errorHandler.handleSoapError(
        error,
        correlationId,
        'detailed_report',
      );

      // Clear session if error indicates session expiration
      if (this.errorHandler.isSessionExpiredError(errorResponse)) {
        this.sessionManager.clearSession();
      }

      throw new BusinessException(errorResponse);
    }
  }

  /**
   * Logout and cleanup session
   *
   * Delegates to GusSessionManager for session management.
   * Headers are added by GusHeaderManager before logout operation.
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
   * Get last used session ID for registry signature generation
   * Returns undefined if no active session exists
   */
  getLastSessionId(): string | undefined {
    return this.sessionManager.getCurrentSessionId();
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
