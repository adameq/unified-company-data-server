import { createMachine, assign, fromCallback, fromPromise, setup } from 'xstate';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { RetryStrategy } from './retry-strategy.interface';

/**
 * Retry State Machine for External API Calls
 *
 * Implements exponential backoff retry logic with per-service configuration.
 * Used as a sub-machine by the main orchestration machine for resilient API calls.
 *
 * Constitutional compliance:
 * - Formal state machine instead of imperative if/else logic
 * - Configurable retry limits per service (GUS, KRS, CEIDG)
 * - Exponential backoff with jitter
 * - Comprehensive logging of all state transitions
 * - Strategy Pattern for service-specific retry logic (Open/Closed Principle)
 *
 * Architecture (XState v5):
 * - Uses setup() to define stub actors that can be overridden via .provide()
 * - makeApiRequest is a stub that MUST be provided by parent machine
 * - RetryStrategy injected via input for service-specific retry logic
 * - Machine is fully generic and reusable across any service
 */

// Retry context schema for validation
// Validates retry mechanism state and service-specific parameters
const RetryContextSchema = z.object({
  serviceName: z.string().min(1),  // Generic string (not enum) for extensibility
  attempt: z.number().min(0),
  maxRetries: z.number().min(1).max(5),
  initialDelay: z.number().min(50).max(2000),
  correlationId: z.string().min(1),

  // Service-specific parameters (optional, depends on service type)
  nip: z.string().optional(),        // For GUS classification, CEIDG
  regon: z.string().optional(),      // For GUS detailed data
  silosId: z.string().optional(),    // For GUS detailed data
  krsNumber: z.string().optional(),  // For KRS
  registry: z.enum(['P', 'S']).optional(), // For KRS registry type

  // Retry strategy (injected via input, not validated by Zod)
  retryStrategy: z.any(),  // RetryStrategy instance

  lastError: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      errorCode: z.string().optional(),  // For ErrorResponse compatibility
      source: z.string().optional(),
      timestamp: z.string().datetime(),  // ISO 8601 format
    })
    .optional(),
  result: z.any().optional(),
});

export type RetryContext = z.infer<typeof RetryContextSchema>;

// Input type for retry machine
// Contains service-specific parameters passed by parent machine
export interface RetryInput {
  correlationId: string;
  retryStrategy: RetryStrategy;  // Injected strategy for retry logic
  // Service-specific params (one or more of these will be present):
  nip?: string;           // For GUS classification, CEIDG
  regon?: string;         // For GUS detailed data
  silosId?: string;       // For GUS detailed data
  krsNumber?: string;     // For KRS
  registry?: 'P' | 'S';   // For KRS registry type
}

/**
 * Input type for makeApiRequest actor
 *
 * This actor is provided by parent machine via .provide().
 * Explicit type annotation solves XState v5 type inference limitation.
 *
 * Context contains all service-specific parameters needed for API call
 * (nip, regon, krsNumber, etc.) as defined in RetryContext.
 */
export interface MakeApiRequestInput {
  context: RetryContext;
}

// Events that the retry machine can receive
export type RetryEvent =
  | { type: 'REQUEST'; payload: any }
  | { type: 'SUCCESS'; data: any }
  | { type: 'FAILURE'; error: { message: string; code?: string } }
  | { type: 'RETRY_TIMEOUT' }
  | { type: 'RESET' };

// Service configuration per external API
export interface ServiceRetryConfig {
  maxRetries: number;
  initialDelay: number;
}

// Calculate exponential backoff delay with jitter
export const calculateBackoffDelay = (
  attempt: number,
  initialDelay: number,
  maxDelay = 5000,
): number => {
  const exponentialDelay = initialDelay * Math.pow(2, attempt);
  const jitter = (Math.random() - 0.5) * 0.2 * exponentialDelay; // ±10% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelay);
  return Math.round(delay);
};

/**
 * Retry logic is now delegated to RetryStrategy instances.
 * Each service (GUS, KRS, CEIDG) implements its own strategy class.
 *
 * Previous implementation: canBeRetriedByService(error, serviceType)
 * New implementation: context.retryStrategy.canRetry(error)
 *
 * Benefits:
 * - Open/Closed Principle: Add new services without modifying this file
 * - Single Responsibility: Each strategy handles only its service
 * - Testability: Strategies can be tested independently
 * - Extensibility: New services just implement RetryStrategy interface
 */

// Create retry machine factory using setup() for dependency injection
export const createRetryMachine = (
  serviceName: string,  // Generic string (not enum) for extensibility
  correlationId: string,
  logger: Logger,
  serviceConfig: ServiceRetryConfig,
) => {

  const initialContext = {
    serviceName,
    attempt: 0,
    maxRetries: serviceConfig.maxRetries,
    initialDelay: serviceConfig.initialDelay,
    correlationId,
  };

  return setup({
    types: {} as {
      context: RetryContext;
      events: RetryEvent;
      input: RetryInput;
    },
    actors: {
      // makeApiRequest actor MUST be provided via .provide() in parent machine
      // Stub implementation throws error if not overridden
      // Explicit type annotation: fromPromise<TOutput, TInput>
      makeApiRequest: fromPromise<any, MakeApiRequestInput>(async () => {
        throw new Error('makeApiRequest actor must be provided via .provide() by parent machine');
      }),

      // scheduleRetry actor (concrete implementation)
      scheduleRetry: fromCallback(({ sendBack, input }) => {
        const context = input as RetryContext;

        if (!context) {
          logger.error('scheduleRetry called with undefined context');
          return () => {};
        }

        const delay = calculateBackoffDelay(
          context.attempt,
          context.initialDelay,
        );

        logger.debug(
          `Scheduling retry for ${context.serviceName}`,
          {
            correlationId: context.correlationId,
            delayMs: delay
          }
        );

        const timeout = setTimeout(() => {
          sendBack({ type: 'RETRY_TIMEOUT' });
        }, delay);

        return () => {
          clearTimeout(timeout);
        };
      }),
    },
    actions: {
      prepareRequest: assign(({ context }) => {
        logger.debug(
          `[${context.correlationId}] Preparing ${context.serviceName} request`,
        );
        return {
          ...context,
          attempt: 0,
        };
      }),

      incrementAttempt: assign(({ context }) => {
        return {
          ...context,
          attempt: context.attempt + 1,
        };
      }),

      storeError: assign(({ context, event }) => {
        // XState v5: Error from invoke.onError comes in event.error
        const error = (event as any).error || { message: 'Unknown error' };

        // Extract error code from various sources (BusinessException, API errors, etc.)
        const errorCode = error.errorCode || error.code || error.status || undefined;

        return {
          ...context,
          lastError: {
            message: error.message || String(error),
            code: errorCode,  // For internal use
            errorCode,  // For compatibility with ErrorResponse schema
            source: error.source, // Preserve source from BusinessException
            timestamp: new Date().toISOString(),
          },
        };
      }),

      storeResult: assign(({ context, event }) => {
        // XState v5: Result from invoke.onDone comes in event.output
        const resultData = (event as any).output;
        return {
          ...context,
          result: resultData,
        };
      }),

      resetContext: assign(({ context }) => {
        return {
          ...context,
          attempt: 0,
          lastError: undefined,
          result: undefined,
        };
      }),

      logRequestStart: ({ context }) => {
        logger.debug(
          `[${context.correlationId}] Starting ${context.serviceName} request (max retries: ${context.maxRetries})`,
        );
      },

      logRetryableError: ({ context }) => {
        logger.warn(
          `[${context.correlationId}] ${context.serviceName} request failed, attempt ${context.attempt}/${context.maxRetries}`,
          {
            error: context.lastError?.message,
            nextRetryIn: calculateBackoffDelay(
              context.attempt,
              context.initialDelay,
            ),
          },
        );
      },

      logRetryAttempt: ({ context }) => {
        logger.debug(
          `[${context.correlationId}] Retrying ${context.serviceName} request, attempt ${context.attempt + 1}/${context.maxRetries}`,
        );
      },

      logSuccess: ({ context }) => {
        logger.debug(
          `[${context.correlationId}] ${context.serviceName} request succeeded on attempt ${context.attempt + 1}`,
        );
      },

      logFinalSuccess: ({ context }) => {
        logger.debug(
          `[${context.correlationId}] ${context.serviceName} retry machine completed successfully`,
        );
      },

      logFinalFailure: ({ context }) => {
        logger.error(
          `[${context.correlationId}] ${context.serviceName} retry machine failed after ${context.attempt} attempts`,
          {
            lastError: context.lastError,
            maxRetries: context.maxRetries,
          },
        );
      },
    },
    guards: {
      canRetry: ({ context }) => {
        const hasAttemptsLeft = context.attempt < context.maxRetries;

        // Delegate retry logic to injected strategy
        if (context.lastError) {
          const shouldRetry = context.retryStrategy.canRetry(context.lastError);

          logger.debug(
            `Can retry ${context.serviceName}?`,
            {
              correlationId: context.correlationId,
              hasAttemptsLeft,
              attempt: context.attempt,
              maxRetries: context.maxRetries,
              shouldRetry,
              strategy: context.retryStrategy.name,
              errorCode: context.lastError.code,
              errorMessage: context.lastError.message,
            }
          );

          return hasAttemptsLeft && shouldRetry;
        }

        return hasAttemptsLeft;
      },
    },
  }).createMachine(
    {
      /** @xstate-layout N4IgpgJg5mDOIC5QGMCGA7ArgJ0gSwAsBjAOygFcBjAegBVylsQIBJlrA92w5w20 */
      id: `retry-${serviceName.toLowerCase()}`,
      // XState v5: context can be function or object - use function to accept input
      context: ({ input }: { input?: RetryInput }): RetryContext => ({
        ...initialContext,
        correlationId: input?.correlationId || correlationId,
        retryStrategy: input?.retryStrategy || ({} as RetryStrategy),  // Inject strategy from input (required)
        // Pass through service-specific params from input
        ...(input?.nip && { nip: input.nip }),
        ...(input?.regon && { regon: input.regon }),
        ...(input?.silosId && { silosId: input.silosId }),
        ...(input?.krsNumber && { krsNumber: input.krsNumber }),
        ...(input?.registry && { registry: input.registry }),
      }),
      initial: 'attempting',
      states: {
        idle: {
          description: 'Waiting for request to start (not used when invoked as child)',
          on: {
            REQUEST: {
              target: 'attempting',
              actions: ['logRequestStart', 'prepareRequest'],
            },
            RESET: {
              target: 'idle',
              actions: 'resetContext',
            },
          },
        },

        attempting: {
          entry: ({ context }) => {
            logger.debug(`Retry machine entering 'attempting' state`, {
              correlationId: context.correlationId,
              service: context.serviceName,
              attempt: context.attempt,
              maxRetries: context.maxRetries,
            });
          },
          description: 'Making the actual API request',
          invoke: {
            id: 'apiRequest',
            src: 'makeApiRequest',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'success',
              actions: ['storeResult', 'logSuccess'],
            },
            onError: [
              {
                target: 'retrying',
                guard: 'canRetry',
                actions: ['incrementAttempt', 'storeError', 'logRetryableError'],
              },
              {
                target: 'failed',
                actions: ['storeError', 'logFinalFailure'],
              },
            ],
          },
          on: {
            SUCCESS: {
              target: 'success',
              actions: ['storeResult', 'logSuccess'],
            },
            FAILURE: [
              {
                target: 'retrying',
                guard: 'canRetry',
                actions: [
                  'incrementAttempt',
                  'storeError',
                  'logRetryableError',
                ],
              },
              {
                target: 'failed',
                actions: ['storeError', 'logFinalFailure'],
              },
            ],
          },
        },

        retrying: {
          description: 'Waiting before retry with exponential backoff',
          invoke: {
            id: 'retryDelay',
            src: 'scheduleRetry',
            input: ({ context }) => context,
            onDone: {
              target: 'attempting',
              actions: ['logRetryAttempt'],
            },
          },
          on: {
            RETRY_TIMEOUT: {
              target: 'attempting',
              actions: ['logRetryAttempt'],
            },
          },
        },

        success: {
          description: 'Request completed successfully',
          type: 'final',
          entry: ['logFinalSuccess'],
          // XState v5: Return the result data so parent can access via event.output
          output: ({ context }) => context.result,
        },

        failed: {
          description: 'Request failed after all retries exhausted',
          type: 'final',
          entry: ['logFinalFailure'],
          // XState v5: Output error object
          // The parent fromPromise wrapper will receive this in finalSnapshot and throw it
          output: ({ context }) => {
            // Return lastError object (will be thrown by parent)
            // Ensure both 'code' and 'errorCode' fields for compatibility
            return context.lastError || {
              message: `${context.serviceName} retry failed`,
              code: 'RETRY_EXHAUSTED',
              errorCode: 'RETRY_EXHAUSTED',  // For ErrorResponse compatibility
              source: 'INTERNAL',
              timestamp: new Date(),
            };
          },
        },
      },
    },
  );
};

// Utility functions for working with retry machines
export const RetryMachineUtils = {
  /**
   * Create a retry machine for a specific service
   * Note: This utility requires a logger and service config - use createRetryMachine directly in production code
   */
  createForService: (
    service: 'GUS' | 'KRS' | 'CEIDG',
    correlationId: string,
    logger: Logger,
    serviceConfig: ServiceRetryConfig,
  ) => {
    return createRetryMachine(service, correlationId, logger, serviceConfig);
  },

  /**
   * Check if a state is a final state (success or failure)
   */
  isFinalState: (state: string): boolean => {
    return state === 'success' || state === 'failed';
  },

  /**
   * Check if a state indicates success
   */
  isSuccessState: (state: string): boolean => {
    return state === 'success';
  },

  /**
   * Check if a state indicates failure
   */
  isFailureState: (state: string): boolean => {
    return state === 'failed';
  },

  /**
   * Get retry statistics from context
   */
  getRetryStats: (context: RetryContext) => {
    return {
      service: context.serviceName,
      attempts: context.attempt,
      maxRetries: context.maxRetries,
      hasError: !!context.lastError,
      lastErrorMessage: context.lastError?.message,
      lastErrorTime: context.lastError?.timestamp,
    };
  },

  /**
   * Calculate next retry delay
   */
  getNextRetryDelay: (context: RetryContext): number => {
    return calculateBackoffDelay(context.attempt, context.initialDelay);
  },
};

// Export schema for validation
export { RetryContextSchema };
