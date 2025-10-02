/**
 * Type declarations for strong-soap library
 *
 * This file provides TypeScript type definitions for the strong-soap SOAP client library.
 * Since strong-soap does not have official @types package, we declare minimal types here.
 */

declare module 'strong-soap' {
  export namespace soap {
    interface Client {
      [operationName: string]: (
        args: any,
        callback: (err: Error | null, result: any, envelope?: any, soapHeader?: any) => void,
        options?: any,
      ) => void;

      lastRequest?: string;
      lastResponse?: string;

      setEndpoint(endpoint: string): void;
      addHttpHeader(name: string, value: string): void;
      clearHttpHeaders(): void;
      clearSoapHeaders(): void;

      /**
       * Add SOAP header to requests
       * Supports XML string format (single argument overload)
       * See: https://github.com/loopbackio/strong-soap/issues/84
       */
      addSoapHeader(xmlString: string): void;

      /**
       * Optional session ID storage for custom implementations
       */
      _sessionId?: string;
    }

    interface CreateClientOptions {
      endpoint?: string;
      wsdl_options?: {
        timeout?: number;
      };
    }

    function createClient(
      wsdlUrl: string,
      options: CreateClientOptions,
      callback: (err: Error | null, client: Client) => void,
    ): void;
  }
}
