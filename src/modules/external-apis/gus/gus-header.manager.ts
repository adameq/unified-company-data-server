import { Injectable, Logger } from '@nestjs/common';
import { soap } from 'strong-soap';
import { GusSessionManager } from './gus-session.manager';
import type { GusConfig } from './interfaces/gus-session.interface';

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
 * const session = await sessionManager.getSession(correlationId);
 * const headerManager = new GusHeaderManager(sessionManager, config);
 *
 * // IMPORTANT: Manually attach headers before each SOAP operation
 * headerManager.attach(session.client, 'DaneSzukajPodmioty');
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
    private readonly sessionManager: GusSessionManager,
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
   */
  attach(client: soap.Client, operation: string): void {
    this.addHeaders(client, operation);
    this.logger.debug('Headers added for operation', { operation });
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
   */
  private addHeaders(client: soap.Client, operation: string): void {
    const session = this.sessionManager.getCurrentSession();

    if (!session) {
      this.logger.warn(
        'No active session found, skipping header injection for operation',
        { operation },
      );
      return;
    }

    // 1. Add HTTP header 'sid' (session ID)
    client.clearHttpHeaders();
    client.addHttpHeader('sid', session.sessionId);

    // 2. Add SOAP WS-Addressing headers
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

    this.logger.debug('Headers added automatically by interceptor', {
      operation,
      action,
      sessionIdPrefix: session.sessionId.substring(0, 8) + '...',
    });
  }
}
