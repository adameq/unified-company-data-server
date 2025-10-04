import { Injectable, Logger } from '@nestjs/common';
import { soap } from 'strong-soap';
import { z } from 'zod';
import {
  createErrorResponse,
  type ErrorResponse,
} from '@schemas/error-response.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import type { GusSession, GusConfig } from './interfaces/gus-session.interface';
import { GusSoapClient } from './gus-soap-client.facade';
import { GusHeaderManager } from './gus-header.manager';
import {
  createSoapClient,
  callSimpleSoapOperation,
} from './gus-soap.helpers';

/**
 * Zaloguj (Login) response schema
 *
 * GUS WSDL defines Zaloguj operation to return a string sessionId.
 * strong-soap may return the sessionId in two formats:
 * 1. Direct string - when strong-soap unwraps single-value SOAP responses
 * 2. Object {ZalogujResult: string} - standard WSDL response structure
 */
export const ZalogujResponseSchema = z.union([
  z.string().min(20).describe('Session ID returned directly as string'),
  z.object({
    ZalogujResult: z
      .string()
      .min(20)
      .describe('Session ID in standard WSDL response object'),
  }).describe('Standard WSDL response with ZalogujResult field'),
]);

export type ZalogujResponse = z.infer<typeof ZalogujResponseSchema>;

/**
 * GusSessionManager
 *
 * Manages GUS API session lifecycle with thread-safe session creation.
 *
 * Responsibilities:
 * - Creating new GUS sessions via Zaloguj operation
 * - Validating session expiration
 * - Preventing race conditions with concurrent session requests
 * - Providing active session to GusService
 *
 * Race Condition Protection:
 * - Uses isRefreshing flag to prevent concurrent session creation
 * - Queues concurrent requests to wait for ongoing session refresh
 * - Only one request creates new session, others reuse the same promise
 *
 * Session Lifecycle:
 * 1. Check if current session exists and is valid
 * 2. If expired or missing, create new session
 * 3. Login via Zaloguj SOAP operation
 * 4. Store session with expiration time
 * 5. Return active session to caller
 *
 * NOTE: This class delegates all header management to GusHeaderManager:
 *       - Login (Zaloguj): Uses GusHeaderManager.addHeadersForLogin()
 *       - Other operations: GusSoapClient facade calls GusHeaderManager.attach()
 */
@Injectable()
export class GusSessionManager {
  private readonly logger = new Logger(GusSessionManager.name);
  private currentSession: GusSession | null = null;

  // Session refresh locking to prevent race conditions
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<GusSession> | null = null;

  constructor(private readonly config: GusConfig) {}

  /**
   * Get current session or create new one if expired
   *
   * Thread-safe method that:
   * - Returns existing session if valid
   * - Creates new session if expired or missing
   * - Queues concurrent requests to wait for ongoing session creation
   *
   * @param correlationId - Request correlation ID for logging
   * @returns Active GUS session with authenticated SOAP client
   */
  async getSession(correlationId: string): Promise<GusSession> {
    // Return current session if valid
    if (this.currentSession && this.isSessionValid()) {
      this.logger.debug('Reusing existing GUS session', {
        correlationId,
        expiresAt: this.currentSession.expiresAt,
      });
      return this.currentSession;
    }

    // If session refresh is already in progress, wait for it
    if (this.isRefreshing && this.refreshPromise) {
      this.logger.debug('Session refresh already in progress, waiting...', {
        correlationId,
      });
      return this.refreshPromise;
    }

    // Start new session refresh with locking
    this.isRefreshing = true;
    this.refreshPromise = this.createNewSession(correlationId)
      .then((session) => {
        this.isRefreshing = false;
        this.refreshPromise = null;
        return session;
      })
      .catch((error) => {
        this.isRefreshing = false;
        this.refreshPromise = null;
        throw error;
      });

    return this.refreshPromise;
  }

  /**
   * Check if current session is valid (not expired)
   */
  isSessionValid(): boolean {
    if (!this.currentSession) {
      return false;
    }
    return new Date() < this.currentSession.expiresAt;
  }

  /**
   * Get current session without creating new one
   * Used by GusHeaderManager to access sessionId
   */
  getCurrentSession(): GusSession | null {
    return this.currentSession;
  }

  /**
   * Clear current session (for logout or error recovery)
   */
  clearSession(): void {
    this.currentSession = null;
    this.logger.debug('Session cleared');
  }

  /**
   * Create new authenticated session using strong-soap
   *
   * Steps:
   * 1. Create strong-soap client from WSDL
   * 2. Add WS-Addressing headers via GusHeaderManager.addHeadersForLogin()
   * 3. Login via Zaloguj operation
   * 4. Extract and validate sessionId
   * 5. Store session with expiration time
   *
   * NOTE: All header management is delegated to GusHeaderManager.
   */
  private async createNewSession(correlationId: string): Promise<GusSession> {
    this.logger.log('Creating new GUS session with strong-soap', {
      correlationId,
    });

    try {
      // Step 1: Create strong-soap client from WSDL using promisified helper
      const client = await createSoapClient(this.config.wsdlUrl, {
        endpoint: this.config.baseUrl,
        wsdl_options: {
          timeout: 10000, // 10s timeout for WSDL loading
        },
      });

      // Set the endpoint explicitly
      client.setEndpoint(this.config.baseUrl);

      this.logger.log('strong-soap client created from WSDL', {
        endpoint: this.config.baseUrl,
        correlationId,
      });

      // Step 2: Add WS-Addressing headers for Zaloguj operation
      // IMPORTANT: Zaloguj DOES require WS-Addressing headers
      // Use GusHeaderManager to avoid code duplication
      // (headerManager will be reused later for GusSoapClient facade)
      const headerManager = new GusHeaderManager(this.config);
      headerManager.addHeadersForLogin(client);

      // Step 3: Perform login using Zaloguj operation (using promisified helper)
      const loginResult = await callSimpleSoapOperation(
        client.Zaloguj,
        { pKluczUzytkownika: this.config.userKey },
        client,
      ).catch((err: Error) => {
        // Log error details for debugging
        this.logger.warn('Zaloguj operation failed', {
          error: err.message,
          lastRequest: client.lastRequest
            ? client.lastRequest.substring(0, 1200)
            : 'N/A',
          lastResponse: client.lastResponse
            ? client.lastResponse.substring(0, 1200)
            : 'N/A',
          correlationId,
        });
        throw err;
      });

      // Log actual SOAP request for debugging
      if (client.lastRequest) {
        this.logger.debug('Zaloguj SOAP Request (first 1200 chars)', {
          request: client.lastRequest.substring(0, 1200),
          correlationId,
        });
      }

      this.logger.debug('Zaloguj operation completed successfully', {
        resultIsNull: loginResult === null,
        correlationId,
      });

      // Step 4: Validate and extract session ID using Zod schema
      const validation = ZalogujResponseSchema.safeParse(loginResult);

      if (!validation.success) {
        this.logger.error('Zaloguj response failed schema validation', {
          loginResultType: typeof loginResult,
          loginResultValue: JSON.stringify(loginResult),
          loginResultKeys:
            typeof loginResult === 'object' && loginResult !== null
              ? Object.keys(loginResult)
              : 'N/A',
          zodErrors: validation.error.issues,
          correlationId,
        });

        throw new BusinessException({
          errorCode: 'GUS_INVALID_RESPONSE',
          message:
            'GUS API returned unexpected Zaloguj response structure. Expected string or {ZalogujResult: string}.',
          correlationId,
          source: 'GUS',
          details: {
            zodErrors: validation.error.issues,
            responseStructure:
              typeof loginResult === 'object' && loginResult !== null
                ? Object.keys(loginResult)
                : typeof loginResult,
          },
        });
      }

      // Extract sessionId from validated response
      const sessionId =
        typeof validation.data === 'string'
          ? validation.data
          : validation.data.ZalogujResult;

      // Log which response structure was used (for monitoring API behavior)
      const responseType =
        typeof validation.data === 'string'
          ? 'direct-string'
          : 'ZalogujResult-object';
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

      // Step 5: Create GusSoapClient facade for automatic header injection
      const expiresAt = new Date(Date.now() + this.config.sessionTimeoutMs);

      // Temporarily store session to pass to GusSoapClient constructor
      const tempSession: GusSession = {
        sessionId,
        expiresAt,
        rawClient: client,
        soapClient: null as any, // Will be set immediately below
      };

      // Reuse headerManager from Step 2 (already created for Zaloguj)
      const soapClient = new GusSoapClient(client, headerManager, tempSession);

      // Update session with facade
      this.currentSession = {
        sessionId,
        expiresAt,
        rawClient: client,
        soapClient,
      };

      this.logger.log('GUS session created successfully with GusSoapClient facade', {
        sessionId: sessionId.substring(0, 8) + '...',
        expiresAt,
        correlationId,
      });

      return this.currentSession;
    } catch (error) {
      const errorObj = error as any;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error('Failed to create GUS session with strong-soap', {
        error: errorMessage,
        errorCode: errorObj.code,
        correlationId,
      });

      // Detailed error analysis for better diagnostics

      // 1. Timeout errors (WSDL loading or Zaloguj operation)
      if (
        errorObj.code === 'ECONNABORTED' ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ETIMEDOUT')
      ) {
        throw new BusinessException(
          createErrorResponse({
            errorCode: 'TIMEOUT_ERROR',
            message: 'GUS service timeout during session creation',
            correlationId,
            source: 'GUS',
            details: {
              originalError: errorMessage,
              errorCode: errorObj.code,
              operation: 'createSession',
            },
          }),
        );
      }

      // 2. Network/connection errors
      if (
        errorObj.code === 'ECONNREFUSED' ||
        errorObj.code === 'ENOTFOUND' ||
        errorObj.code === 'ECONNRESET' ||
        errorMessage.includes('socket hang up') ||
        errorMessage.includes('getaddrinfo')
      ) {
        throw new BusinessException(
          createErrorResponse({
            errorCode: 'GUS_CONNECTION_ERROR',
            message: 'Cannot connect to GUS service',
            correlationId,
            source: 'GUS',
            details: {
              originalError: errorMessage,
              errorCode: errorObj.code,
              wsdlUrl: this.config.wsdlUrl,
              baseUrl: this.config.baseUrl,
            },
          }),
        );
      }

      // 3. WSDL parsing errors (invalid XML, schema errors)
      if (
        errorMessage.toLowerCase().includes('wsdl') ||
        errorMessage.toLowerCase().includes('parse') ||
        errorMessage.toLowerCase().includes('invalid') ||
        errorMessage.toLowerCase().includes('xml')
      ) {
        throw new BusinessException(
          createErrorResponse({
            errorCode: 'GUS_WSDL_PARSE_ERROR',
            message: 'Failed to parse GUS WSDL definition',
            correlationId,
            source: 'GUS',
            details: {
              originalError: errorMessage,
              wsdlUrl: this.config.wsdlUrl,
            },
          }),
        );
      }

      // 4. Authentication errors (invalid API key, access denied) - fallback
      throw new BusinessException(
        createErrorResponse({
          errorCode: 'GUS_AUTHENTICATION_FAILED',
          message: 'Failed to authenticate with GUS service',
          correlationId,
          source: 'GUS',
          details: {
            originalError: errorMessage,
            errorCode: errorObj.code,
          },
        }),
      );
    }
  }

  /**
   * Logout and cleanup session
   *
   * Uses GusSoapClient facade which automatically adds WS-Addressing headers.
   */
  async logout(correlationId: string): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const session = this.currentSession; // Capture for TypeScript type narrowing

    try {
      // Call Wyloguj operation using facade (headers automatically injected)
      await session.soapClient.wyloguj(session.sessionId);

      this.logger.log('Wyloguj operation succeeded', { correlationId });
      this.logger.log('Successfully logged out from GUS', { correlationId });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn('Wyloguj operation failed', {
        error: errorMessage,
        correlationId,
      });
      this.logger.warn('Failed to logout from GUS', {
        error: errorMessage,
        correlationId,
      });
      // Don't throw - logout is best-effort
    } finally {
      this.clearSession();
    }
  }
}
