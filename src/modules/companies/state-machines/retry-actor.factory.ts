import { fromPromise, createActor, toPromise } from 'xstate';
import { Logger } from '@nestjs/common';
import { createRetryMachine, type MakeApiRequestInput } from './retry.machine';
import type { RetryStrategy } from './retry-strategy.interface';
import type { RetryContext } from './retry.machine';

/**
 * Retry Actor Factory
 *
 * Eliminates code duplication in orchestration.service.ts by providing a generic
 * factory function for creating retry actors with consistent behavior.
 *
 * Problem solved:
 * - Previously: 4 nearly identical retry actors (~42 lines each, ~180 lines total)
 * - Code duplication across retryGusClassification, retryGusDetailedData, retryKrsData, retryCeidgData
 * - Inconsistencies (e.g., KRS used Promise pattern, others used toPromise())
 * - Maintenance burden: changes required updating 4 places
 *
 * Solution:
 * - Single factory function encapsulates retry machine creation logic
 * - Generic types for type-safe input/output across different services
 * - Consistent behavior and error handling across all retry actors
 * - Reduces ~180 lines of duplication to ~28 lines of factory calls
 *
 * Usage example:
 * ```typescript
 * retryGusClassification: createRetryActor({
 *   strategyName: this.gusRetryStrategy.name,
 *   retryStrategy: this.gusRetryStrategy,
 *   retryConfig: this.machineConfig.retry.gus,
 *   logger: this.logger,
 *   serviceCall: (ctx) => this.gusService.getClassificationByNip(ctx.nip!, ctx.correlationId),
 * })
 * ```
 *
 * Benefits:
 * - Single source of truth for retry actor creation
 * - Type-safe with generic input/output types
 * - Easier maintenance (update once, all actors benefit)
 * - Consistent error handling and logging
 * - Improved readability of orchestration machine
 */

/**
 * Retry configuration shape (per-service)
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
}

/**
 * Factory configuration for creating retry actors
 */
export interface RetryActorConfig<TInput, TResult> {
  /**
   * Strategy name for logging (e.g., 'GUS', 'KRS', 'CEIDG')
   */
  strategyName: string;

  /**
   * Retry strategy instance for service-specific retry logic
   */
  retryStrategy: RetryStrategy;

  /**
   * Service-specific retry configuration (maxRetries, initialDelay)
   */
  retryConfig: RetryConfig;

  /**
   * Logger instance for state machine logging
   */
  logger: Logger;

  /**
   * Service call function that receives retry context and returns result
   *
   * Example:
   * ```typescript
   * serviceCall: (ctx) => this.gusService.getClassificationByNip(ctx.nip!, ctx.correlationId)
   * ```
   *
   * The function receives the full retry context which includes:
   * - correlationId: Request correlation ID
   * - nip, regon, silosId, krsNumber, registry: Service-specific parameters
   * - All other retry context fields (attempt, maxRetries, etc.)
   */
  serviceCall: (context: RetryContext) => Promise<TResult>;
}

/**
 * Create a retry actor with consistent behavior
 *
 * This factory function eliminates code duplication by providing a reusable
 * pattern for creating XState fromPromise actors with retry logic.
 *
 * The factory handles:
 * 1. Retry machine creation and configuration
 * 2. Actor lifecycle (create, start, wait for completion)
 * 3. Error handling and result extraction
 * 4. Consistent logging and correlation tracking
 *
 * @template TInput - Input type for the actor (e.g., { nip: string, correlationId: string })
 * @template TResult - Result type returned by the service call
 * @param config - Factory configuration
 * @returns XState fromPromise actor ready for use in orchestration machine
 */
export function createRetryActor<TInput extends { correlationId: string }, TResult>(
  config: RetryActorConfig<TInput, TResult>,
) {
  return fromPromise(async ({ input }: { input: TInput }) => {
    const { correlationId } = input;

    // Create retry machine with service-specific configuration
    const retryMachine = createRetryMachine(
      config.strategyName,
      correlationId,
      config.logger,
      config.retryConfig,
    ).provide({
      actors: {
        // Provide the actual API call implementation
        // Explicit type annotation resolves XState v5 type inference limitation
        makeApiRequest: fromPromise<any, MakeApiRequestInput>(async ({ input: apiInput }) => {
          const { context: retryContext } = apiInput;
          return config.serviceCall(retryContext);
        }),
      },
    });

    // Create and start actor with input parameters
    const actor = createActor(retryMachine, {
      input: {
        ...input, // Spread input to pass all service-specific params (nip, regon, etc.)
        retryStrategy: config.retryStrategy,
      },
    });
    actor.start();

    // Wait for completion using XState v5 toPromise() helper (idiomatic pattern)
    await toPromise(actor);

    // Extract result from final state snapshot
    const snapshot = actor.getSnapshot();

    // Check for failure states
    if (snapshot.value !== 'success') {
      throw (
        snapshot.output ||
        snapshot.context?.lastError ||
        new Error(`${config.strategyName} retry failed`)
      );
    }

    // Return result from successful execution
    return snapshot.output ?? snapshot.context?.result;
  });
}
