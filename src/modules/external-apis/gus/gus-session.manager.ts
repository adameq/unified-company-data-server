import { Injectable, Logger } from '@nestjs/common';
import { soap } from 'strong-soap';
import { z } from 'zod';
import {
  createErrorResponse,
  type ErrorResponse,
} from '@schemas/error-response.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import type { GusSession, GusConfig } from './interfaces/gus-session.interface';
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
 * NOTE: This class does NOT add SOAP headers (WS-Addressing) or HTTP headers (sid).
 *       Headers are managed by GusHeaderManager, which must be called manually before each operation.
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
   * 2. Login via Zaloguj operation (no WS-Addressing headers needed for login)
   * 3. Extract and validate sessionId
   * 4. Store session with expiration time
   *
   * NOTE: WS-Addressing headers and sid HTTP header are added by GusHeaderManager,
   *       NOT in this method.
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
      // IMPORTANT: Zaloguj DOES require WS-Addressing headers (confirmed from original working code)
      client.clearSoapHeaders();
      client.clearHttpHeaders();

      // Add WS-Addressing headers manually for Zaloguj
      const zalogujAction = 'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj';
      const WS_ADDRESSING_NS = 'http://www.w3.org/2005/08/addressing';
      client.addSoapHeader(
        `<wsa:To xmlns:wsa="${WS_ADDRESSING_NS}">${this.config.baseUrl}</wsa:To>`,
      );
      client.addSoapHeader(
        `<wsa:Action xmlns:wsa="${WS_ADDRESSING_NS}">${zalogujAction}</wsa:Action>`,
      );

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

      // Step 5: Store session information
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

      return this.currentSession;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create GUS session with strong-soap', {
        error: errorMessage,
        correlationId,
      });

      throw createErrorResponse({
        errorCode: 'GUS_AUTHENTICATION_FAILED',
        message:
          'Failed to authenticate with GUS service using strong-soap',
        correlationId,
        source: 'GUS',
        details: { originalError: errorMessage },
      });
    }
  }

  /**
   * Logout and cleanup session
   *
   * NOTE: Wyloguj operation requires WS-Addressing headers which will be added
   *       by GusHeaderManager before the operation.
   */
  async logout(correlationId: string): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const session = this.currentSession; // Capture for TypeScript type narrowing

    try {
      // Call Wyloguj operation using strong-soap (using promisified helper)
      // WS-Addressing headers will be added by GusHeaderManager before this operation
      await callSimpleSoapOperation(
        session.client.Wyloguj,
        { pIdentyfikatorSesji: session.sessionId },
        session.client,
      );

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
