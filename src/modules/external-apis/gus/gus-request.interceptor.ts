import { Injectable, Logger } from '@nestjs/common';
import { soap } from 'strong-soap';
import { GusSessionManager } from './gus-session.manager';
import type { GusConfig } from './interfaces/gus-session.interface';

/**
 * GusRequestInterceptor
 *
 * Automatically adds required headers to all GUS SOAP requests using strong-soap events.
 *
 * Responsibilities:
 * - Attach to strong-soap client 'request' event (emitted before each SOAP call)
 * - Add HTTP header 'sid' (session ID) to all requests
 * - Add SOAP WS-Addressing headers (<wsa:To>, <wsa:Action>) to all requests
 * - Map SOAP operation names to WS-Addressing Action URIs
 *
 * This eliminates the need for manual header management in business methods.
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
 * const interceptor = new GusRequestInterceptor(sessionManager, config);
 * interceptor.attach(session.client);
 *
 * // Now all SOAP operations have headers added automatically
 * session.client.DaneSzukajPodmioty(...);
 * ```
 *
 * Based on:
 * - GUS official documentation (BIR11_Przyklady.pdf, page 5)
 * - strong-soap events: https://github.com/loopbackio/strong-soap#client-events
 */
@Injectable()
export class GusRequestInterceptor {
  private readonly logger = new Logger(GusRequestInterceptor.name);

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
   * Extract operation name from SOAP envelope XML
   *
   * Example SOAP envelope:
   * <soap:Envelope>
   *   <soap:Body>
   *     <ns1:DaneSzukajPodmioty>...</ns1:DaneSzukajPodmioty>
   *   </soap:Body>
   * </soap:Envelope>
   *
   * @param xml - SOAP envelope XML
   * @returns Operation name (e.g., "DaneSzukajPodmioty") or null
   */
  private extractOperationName(xml: string): string | null {
    // Try to match operation name in SOAP Body
    // Pattern: <ns:OperationName> where ns can be any namespace prefix
    const match = xml.match(/<(?:ns\d+:)?(\w+).*?>/);
    if (match && this.OPERATION_ACTIONS[match[1]]) {
      return match[1];
    }

    // Fallback: try each known operation name
    for (const operation of Object.keys(this.OPERATION_ACTIONS)) {
      if (xml.includes(`<${operation}`) || xml.includes(`:${operation}`)) {
        return operation;
      }
    }

    return null;
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
