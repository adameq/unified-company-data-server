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
 * SOAP operation callback signature for operations returning result + envelope
 *
 * Used by operations that need both the result data and SOAP envelope:
 * - DaneSzukajPodmioty (entity search)
 * - DanePobierzPelnyRaport (full report retrieval)
 *
 * @template TResult - Type of the operation result
 */
type SoapOperationCallback<TResult = any> = (
  err: Error | null,
  result: TResult,
  envelope: any,
  soapHeader?: any,
) => void;

/**
 * SOAP operation function signature for multi-value callbacks
 *
 * Represents SOAP client methods that take parameters and a callback
 * returning multiple values (result, envelope, soapHeader).
 *
 * @template TParams - Type of operation parameters
 * @template TResult - Type of operation result
 */
type SoapOperation<TParams = any, TResult = any> = (
  params: TParams,
  callback: SoapOperationCallback<TResult>,
) => void;

/**
 * Simple SOAP operation callback signature for operations returning only result
 *
 * Used by operations that only need the result value:
 * - Zaloguj (login - returns sessionId)
 * - Wyloguj (logout - returns void/success indicator)
 *
 * @template TResult - Type of the operation result
 */
type SimpleSoapOperationCallback<TResult = any> = (
  err: Error | null,
  result: TResult,
  envelope?: any,
  soapHeader?: any,
) => void;

/**
 * Simple SOAP operation function signature
 *
 * Represents SOAP client methods that take parameters and a callback
 * returning primarily a single result value.
 *
 * @template TParams - Type of operation parameters
 * @template TResult - Type of operation result
 */
type SimpleSoapOperation<TParams = any, TResult = any> = (
  params: TParams,
  callback: SimpleSoapOperationCallback<TResult>,
) => void;

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
 * **Why Manual Promise Construction:**
 * This function uses manual `new Promise(...)` instead of `util.promisify` because:
 * 1. **Multi-value callbacks**: SOAP operations return multiple values (result, envelope, soapHeader)
 *    but `util.promisify` only captures the first non-error argument.
 * 2. **Custom transformation**: We need to transform callback args to `{result, envelope}` object.
 * 3. **Context binding**: SOAP client methods require `.bind(context)` to preserve `this` context,
 *    which adds complexity when combined with promisify.
 *
 * Using `util.promisify.custom` symbol would still require manual Promise construction internally,
 * so this direct approach is clearer and more maintainable.
 *
 * **Comparison with util.promisify:**
 * ```typescript
 * // util.promisify approach (loses envelope):
 * const promisified = promisify(operation.bind(context));
 * const result = await promisified(params); // Only gets first callback arg
 *
 * // Manual Promise (current approach - preserves all data):
 * const { result, envelope } = await callSoapOperation(operation, params, context);
 * ```
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
  operation: SoapOperation<any, TResult>,
  params: any,
  context?: any,
): Promise<{ result: TResult; envelope: any }> {
  return new Promise((resolve, reject) => {
    const boundOperation = context ? operation.bind(context) : operation;

    try {
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
    } catch (error) {
      // Catch synchronous errors (e.g., invalid operation, binding errors)
      reject(error);
    }
  });
}

/**
 * Call a simple SOAP operation that doesn't return result/envelope
 *
 * Used for operations like Zaloguj (returns just sessionId) or Wyloguj (returns void).
 *
 * **Why Manual Promise Construction:**
 * Similar to `callSoapOperation`, this uses manual Promise construction for:
 * 1. **Consistency**: Matches the pattern used in `callSoapOperation` for easier maintenance.
 * 2. **Context binding**: Preserves `this` context for SOAP client methods via `.bind(context)`.
 * 3. **Defensive error handling**: try/catch around operation call prevents unhandled rejections.
 * 4. **Type safety**: Explicit callback signature with proper TypeScript types.
 *
 * While `util.promisify` could technically work here (single return value), keeping manual
 * Promise construction maintains consistency with `callSoapOperation` and provides the same
 * defensive error handling benefits.
 *
 * **Why not util.promisify:**
 * ```typescript
 * // util.promisify approach (works but less consistent):
 * const promisified = promisify(operation.bind(context));
 * const result = await promisified(params);
 *
 * // Manual Promise (current approach - consistent + defensive):
 * const result = await callSimpleSoapOperation(operation, params, context);
 * ```
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
  operation: SimpleSoapOperation<any, TResult>,
  params: any,
  context?: any,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const boundOperation = context ? operation.bind(context) : operation;

    try {
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
    } catch (error) {
      // Catch synchronous errors (e.g., invalid operation, binding errors)
      reject(error);
    }
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
