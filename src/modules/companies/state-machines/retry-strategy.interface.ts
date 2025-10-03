/**
 * Retry Strategy Interface
 *
 * Defines how each service determines if an error should be retried.
 * Implements the Strategy Pattern to decouple retry logic from the generic retry machine.
 *
 * Problem solved:
 * - Previously, retry.machine.ts contained hardcoded service-specific logic (canBeRetriedByService)
 * - This violated Single Responsibility Principle - generic machine knew about GUS session errors
 * - Adding new services required modifying the core retry machine
 *
 * Solution:
 * - Each service implements its own RetryStrategy
 * - Generic retry machine delegates retry decisions to the injected strategy
 * - Open/Closed Principle: new services = new strategy class, no machine changes
 *
 * Usage:
 * ```typescript
 * const gusStrategy = new GusRetryStrategy();
 * const retryMachine = createRetryMachine('GUS', correlationId, logger, config);
 * const actor = createActor(retryMachine, {
 *   input: { correlationId, retryStrategy: gusStrategy }
 * });
 * ```
 */

export interface RetryStrategy {
  /**
   * Service name (used for logging and debugging)
   *
   * Example: 'GUS', 'KRS', 'CEIDG'
   */
  readonly name: string;

  /**
   * Determine if error should be retried
   *
   * This method encapsulates service-specific retry logic:
   * - GUS: Retry on 5xx + session errors (SESSION_EXPIRED, SESSION_ERROR)
   * - KRS: Retry only on 5xx errors
   * - CEIDG: Retry only on 5xx errors
   *
   * Universal non-retryable errors (all services):
   * - 404 Not Found (entity doesn't exist)
   * - 400 Bad Request (invalid input)
   * - 401 Unauthorized (auth failure)
   * - 4xx Client Errors (except specific cases)
   *
   * @param error - Error object from API call
   *                May contain: { code, errorCode, status, statusCode, message }
   * @returns true if error is retryable, false otherwise
   */
  canRetry(error: any): boolean;
}
