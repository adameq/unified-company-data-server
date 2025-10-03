import { Logger } from '@nestjs/common';
import { soap } from 'strong-soap';
import { GusHeaderManager } from './gus-header.manager';
import type { GusSession } from './interfaces/gus-session.interface';
import {
  callSoapOperation,
  callSimpleSoapOperation,
} from './gus-soap.helpers';

/**
 * GusSoapClient Facade
 *
 * Encapsulates strong-soap client with automatic header injection.
 * Eliminates the leaky abstraction of manual GusHeaderManager.attach() calls.
 *
 * Responsibilities:
 * - Wrap strong-soap Client with high-level operation methods
 * - Automatically inject HTTP headers (sid) and SOAP headers (WS-Addressing) before each operation
 * - Provide type-safe interface for GUS SOAP operations
 * - Hide implementation details of header management from consumers
 *
 * Benefits:
 * - Zero risk of forgetting to call attach() before operations
 * - Single Responsibility: each method handles one SOAP operation
 * - Easier to test: mock the facade instead of raw soap.Client
 * - Follows Facade pattern for complex subsystem (strong-soap + headers)
 *
 * Usage:
 * ```typescript
 * const soapClient = new GusSoapClient(rawClient, headerManager, session);
 * const { result } = await soapClient.daneSzukajPodmioty({ Nip: '1234567890' });
 * // Headers are automatically added before the operation
 * ```
 */
export class GusSoapClient {
  private readonly logger = new Logger(GusSoapClient.name);

  constructor(
    private readonly client: soap.Client,
    private readonly headerManager: GusHeaderManager,
    private readonly session: GusSession,
  ) {}

  /**
   * Execute DaneSzukajPodmioty operation with automatic header injection
   *
   * @param params - Search parameters (e.g., { Nip: '1234567890' })
   * @returns Promise resolving to { result, envelope }
   */
  async daneSzukajPodmioty(params: {
    Nip: string;
  }): Promise<{ result: any; envelope: any }> {
    // Automatically attach headers before operation
    this.headerManager.attach(this.client, 'DaneSzukajPodmioty', this.session);

    this.logger.debug('Calling DaneSzukajPodmioty with auto-injected headers', {
      nipLength: params.Nip.length,
    });

    // Execute SOAP operation
    return callSoapOperation(
      this.client.DaneSzukajPodmioty,
      { pParametryWyszukiwania: params },
      this.client,
    );
  }

  /**
   * Execute DanePobierzPelnyRaport operation with automatic header injection
   *
   * @param regon - Company REGON number (9 or 14 digits)
   * @param reportName - GUS report name (e.g., 'BIR11OsPrawna')
   * @returns Promise resolving to { result, envelope }
   */
  async danePobierzPelnyRaport(
    regon: string,
    reportName: string,
  ): Promise<{ result: any; envelope: any }> {
    // Automatically attach headers before operation
    this.headerManager.attach(
      this.client,
      'DanePobierzPelnyRaport',
      this.session,
    );

    this.logger.debug(
      'Calling DanePobierzPelnyRaport with auto-injected headers',
      {
        regonLength: regon.length,
        reportName,
      },
    );

    // Execute SOAP operation
    return callSoapOperation(
      this.client.DanePobierzPelnyRaport,
      { pRegon: regon, pNazwaRaportu: reportName },
      this.client,
    );
  }

  /**
   * Execute Wyloguj operation with automatic header injection
   *
   * @param sessionId - Current GUS session ID
   * @returns Promise resolving to void
   */
  async wyloguj(sessionId: string): Promise<void> {
    // Automatically attach headers before operation
    this.headerManager.attach(this.client, 'Wyloguj', this.session);

    this.logger.debug('Calling Wyloguj with auto-injected headers', {
      sessionIdPrefix: sessionId.substring(0, 8) + '...',
    });

    // Execute SOAP operation
    await callSimpleSoapOperation(
      this.client.Wyloguj,
      { pIdentyfikatorSesji: sessionId },
      this.client,
    );
  }

  /**
   * Get last SOAP request XML (for debugging)
   */
  getLastRequest(): string | undefined {
    return this.client.lastRequest;
  }

  /**
   * Get last SOAP response XML (for debugging)
   */
  getLastResponse(): string | undefined {
    return this.client.lastResponse;
  }
}
