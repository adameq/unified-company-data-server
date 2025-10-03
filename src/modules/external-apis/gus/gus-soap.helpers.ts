import { promisify } from 'util';
import { soap } from 'strong-soap';

/**
 * GUS SOAP Helper Utilities
 *
 * Eliminates Promise constructor anti-pattern by using Node.js util.promisify
 * for strong-soap callback-based API.
 *
 * Benefits:
 * - Cleaner, more declarative code
 * - Reduced boilerplate (no manual resolve/reject)
 * - Less error-prone (automatic error handling)
 * - Easier to test (mockable functions)
 * - Follows Node.js best practices
 */

/**
 * Promisified version of soap.createClient
 *
 * Usage:
 * ```typescript
 * const client = await createSoapClient(wsdlUrl, {
 *   endpoint: baseUrl,
 *   wsdl_options: { timeout: 10000 }
 * });
 * ```
 *
 * Replaces:
 * ```typescript
 * const client = await new Promise<soap.Client>((resolve, reject) => {
 *   soap.createClient(wsdlUrl, options, (err, client) => {
 *     if (err) reject(err);
 *     else resolve(client);
 *   });
 * });
 * ```
 */
export const createSoapClient = promisify<string, any, soap.Client>(
  soap.createClient,
);

/**
 * Call a SOAP operation and return the result
 *
 * Handles the common pattern of SOAP operations that return (err, result, envelope, soapHeader).
 * Extracts result and envelope for further processing.
 *
 * @param operation - SOAP client operation method (e.g., client.DaneSzukajPodmioty)
 * @param params - Operation parameters
 * @param context - Optional context object for binding (usually the client)
 * @returns Promise resolving to { result, envelope }
 *
 * Usage:
 * ```typescript
 * const { result, envelope } = await callSoapOperation(
 *   client.DaneSzukajPodmioty,
 *   { pParametryWyszukiwania: { Nip: '1234567890' } },
 *   client
 * );
 * ```
 */
export function callSoapOperation<TResult = any>(
  operation: Function,
  params: any,
  context?: any,
): Promise<{ result: TResult; envelope: any }> {
  return new Promise((resolve, reject) => {
    const boundOperation = context ? operation.bind(context) : operation;

    boundOperation(
      params,
      (
        err: Error | null,
        result: TResult,
        envelope: any,
        soapHeader?: any,
      ) => {
        if (err) {
          reject(err);
        } else {
          resolve({ result, envelope });
        }
      },
    );
  });
}

/**
 * Call a simple SOAP operation that doesn't return result/envelope
 *
 * Used for operations like Zaloguj (returns just sessionId) or Wyloguj (returns void).
 *
 * @param operation - SOAP client operation method
 * @param params - Operation parameters
 * @param context - Optional context object for binding (usually the client)
 * @returns Promise resolving to the operation result
 *
 * Usage:
 * ```typescript
 * const sessionId = await callSimpleSoapOperation(
 *   client.Zaloguj,
 *   { pKluczUzytkownika: userKey },
 *   client
 * );
 * ```
 */
export function callSimpleSoapOperation<TResult = any>(
  operation: Function,
  params: any,
  context?: any,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const boundOperation = context ? operation.bind(context) : operation;

    boundOperation(
      params,
      (
        err: Error | null,
        result: TResult,
        envelope?: any,
        soapHeader?: any,
      ) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      },
    );
  });
}

/**
 * Extract SOAP operation result with case-insensitive key matching
 *
 * Handles strong-soap's inconsistent XML parsing behavior where
 * response keys may vary in casing due to xml2js configuration.
 * strong-soap uses xml2js internally but does not expose configuration
 * options, leading to unpredictable key casing in SOAP responses.
 *
 * This function provides a robust fallback mechanism that works regardless
 * of how strong-soap or xml2js parses the XML response.
 *
 * @param result - SOAP operation result object from strong-soap
 * @param operationName - SOAP operation name (e.g., "DaneSzukajPodmioty")
 * @returns Extracted result value or null if not found
 *
 * @example
 * ```typescript
 * const { result } = await callSoapOperation(client.DaneSzukajPodmioty, params, client);
 * const xmlData = extractSoapResult(result, 'DaneSzukajPodmioty');
 * // Works for: DaneSzukajPodmiotyResult, daneszszukajpodmiotyresult, etc.
 * ```
 */
export function extractSoapResult(
  result: any,
  operationName: string,
): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const resultKey = `${operationName}Result`;

  // Try exact match first (optimization for common case)
  if (result[resultKey]) {
    return result[resultKey];
  }

  // Fallback: case-insensitive search across all keys
  const normalizedKey = resultKey.toLowerCase();
  const matchingKey = Object.keys(result).find(
    (key) => key.toLowerCase() === normalizedKey,
  );

  return matchingKey ? result[matchingKey] : null;
}
