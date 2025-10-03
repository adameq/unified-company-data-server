import { Injectable, Logger } from '@nestjs/common';
import { soap } from 'strong-soap';
import type { GusConfig, GusSession } from './interfaces/gus-session.interface';

/**
 * GusHeaderManager
 *
 * Manages HTTP and SOAP headers for GUS API requests.
 * Must be invoked manually before each SOAP operation.
 *
 * Responsibilities:
 * - Add HTTP header 'sid' (session ID) to SOAP client
 * - Add SOAP WS-Addressing headers (<wsa:To>, <wsa:Action>) to SOAP client
 * - Map SOAP operation names to WS-Addressing Action URIs
 *
 * NOTE: This is NOT an automatic interceptor. The attach() method must be
 * called manually before each SOAP operation because strong-soap does not
 * provide a global 'request' event for automatic header injection.
 *
 * Headers Added:
 * 1. HTTP Header: sid = {sessionId}
 * 2. SOAP Header: <wsa:To xmlns:wsa="...">{baseUrl}</wsa:To>
 * 3. SOAP Header: <wsa:Action xmlns:wsa="...">{action}</wsa:Action>
 *
 * Supported Operations:
 * - Zaloguj (login)
 * - DaneSzukajPodmioty (classification search)
 * - DanePobierzPelnyRaport (detailed report)
 * - Wyloguj (logout)
 *
 * Usage:
 * ```typescript
 * const sessionManager = new GusSessionManager(config);
 * const headerManager = new GusHeaderManager(config);
 * const session = await sessionManager.getSession(correlationId);
 *
 * // IMPORTANT: Manually attach headers before each SOAP operation
 * // Pass session explicitly to avoid hidden temporal dependencies
 * headerManager.attach(session.client, 'DaneSzukajPodmioty', session);
 * await session.client.DaneSzukajPodmioty(...);
 * ```
 *
 * Based on:
 * - GUS official documentation (BIR11_Przyklady.pdf, page 5)
 * - strong-soap client API: https://github.com/loopbackio/strong-soap
 */
@Injectable()
export class GusHeaderManager {
  private readonly logger = new Logger(GusHeaderManager.name);

  // WS-Addressing namespace (required by GUS API)
  private readonly WS_ADDRESSING_NS = 'http://www.w3.org/2005/08/addressing';

  // Mapping of SOAP operation names to WS-Addressing Action URIs
  private readonly OPERATION_ACTIONS: Record<string, string> = {
    Zaloguj:
      'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj',
    DaneSzukajPodmioty:
      'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty',
    DanePobierzPelnyRaport:
      'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DanePobierzPelnyRaport',
    Wyloguj:
      'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Wyloguj',
  };

  constructor(
    private readonly config: GusConfig,
  ) {}

  /**
   * Attach interceptor to strong-soap client
   *
   * NOTE: strong-soap does NOT have a 'request' event that fires before each operation.
   * Instead, we use a wrapper approach: headers must be added before each SOAP call.
   * This method is called from GusService before each operation.
   *
   * @param client - strong-soap client to attach to
   * @param operation - SOAP operation name (e.g., "DaneSzukajPodmioty")
   * @param session - Active GUS session with sessionId (explicit dependency)
   */
  attach(client: soap.Client, operation: string, session: GusSession): void {
    this.addHeaders(client, operation, session);
    this.logger.debug('Headers added for operation', { operation });
  }

  /**
   * Add WS-Addressing headers for Zaloguj (login) operation
   *
   * Special case: Zaloguj doesn't need sessionId (not authenticated yet).
   * Only adds SOAP WS-Addressing headers, no HTTP 'sid' header.
   *
   * @param client - strong-soap client
   */
  addHeadersForLogin(client: soap.Client): void {
    client.clearSoapHeaders();
    client.clearHttpHeaders();

    this.addWsAddressingHeaders(client, 'Zaloguj');

    this.logger.debug('WS-Addressing headers added for Zaloguj', {
      operation: 'Zaloguj',
    });
  }

  /**
   * Add WS-Addressing headers without session (for unauthenticated operations)
   *
   * @param client - strong-soap client
   * @param operation - SOAP operation name
   */
  private addWsAddressingHeaders(client: soap.Client, operation: string): void {
    const action = this.OPERATION_ACTIONS[operation];
    if (!action) {
      this.logger.warn('Unknown operation, skipping WS-Addressing headers', {
        operation,
      });
      return;
    }

    client.clearSoapHeaders();

    // Add WS-Addressing headers as separate XML strings
    // CRITICAL: Each header must be added separately to avoid XML parsing errors
    client.addSoapHeader(
      `<wsa:To xmlns:wsa="${this.WS_ADDRESSING_NS}">${this.config.baseUrl}</wsa:To>`,
    );
    client.addSoapHeader(
      `<wsa:Action xmlns:wsa="${this.WS_ADDRESSING_NS}">${action}</wsa:Action>`,
    );
  }

  /**
   * Add required headers to SOAP client before request
   *
   * Adds:
   * 1. HTTP header 'sid' (session ID)
   * 2. SOAP WS-Addressing headers (<wsa:To>, <wsa:Action>)
   *
   * @param client - strong-soap client
   * @param operation - SOAP operation name (e.g., "DaneSzukajPodmioty")
   * @param session - Active GUS session with sessionId (explicit dependency)
   */
  private addHeaders(client: soap.Client, operation: string, session: GusSession): void {
    // 1. Add HTTP header 'sid' (session ID)
    client.clearHttpHeaders();
    client.addHttpHeader('sid', session.sessionId);

    // 2. Add SOAP WS-Addressing headers (reuse common logic)
    this.addWsAddressingHeaders(client, operation);

    this.logger.debug('Headers added automatically by interceptor', {
      operation,
      action: this.OPERATION_ACTIONS[operation],
      sessionIdPrefix: session.sessionId.substring(0, 8) + '...',
    });
  }
}
