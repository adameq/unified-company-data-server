import { createMachine, assign, fromCallback, fromPromise, setup } from 'xstate';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

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
 *
 * Architecture (XState v5):
 * - Uses setup() to define stub actors that can be overridden via .provide()
 * - makeApiRequest is a stub that MUST be provided by parent machine
 * - Machine is reusable across different services via dependency injection
 */

// Retry context schema for validation
// Note: Zod v4 has limited function validation - only validates that value is a function
// TypeScript interface (RetryInput) provides compile-time signature validation
const RetryContextSchema = z.object({
  service: z.enum(['GUS', 'KRS', 'CEIDG']),
  attempt: z.number().min(0),
  maxRetries: z.number().min(1).max(5),
  initialDelay: z.number().min(50).max(2000),
  correlationId: z.string().min(1),
  serviceCall: z
    .function()
    .describe('Async service function: () => Promise<any>. Runtime signature validation not available in Zod v4.'),
  lastError: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      timestamp: z.date(),
    })
    .optional(),
  result: z.any().optional(),
});

export type RetryContext = z.infer<typeof RetryContextSchema>;

// Input type for retry machine
// Extended to support passing service-specific parameters
export interface RetryInput {
  serviceCall?: () => Promise<any>; // Optional - can be overridden via .provide()
  correlationId: string;
  // Additional fields for service-specific params (passed through to makeApiRequest)
  [key: string]: any;
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
  const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelay);
  return Math.round(delay);
};

// Determine if error can be retried based on service type
function canBeRetriedByService(error: any, serviceType: 'GUS' | 'KRS' | 'CEIDG'): boolean {
  // Extract error code from various sources
  const errorCode = error?.code || error?.errorCode;
  const statusCode = error?.status || error?.statusCode;

  // 404 and ENTITY_NOT_FOUND never retryable
  if (statusCode === 404 || errorCode === 'ENTITY_NOT_FOUND') {
    return false;
  }

  // 400 level errors (except 404) are never retryable
  if (statusCode >= 400 && statusCode < 500) {
    return false;
  }

  if (serviceType === 'GUS') {
    // GUS: Retry on 5xx AND session errors
    return (
      statusCode >= 500 ||
      errorCode === 'SESSION_EXPIRED' ||
      errorCode === 'SESSION_ERROR' ||
      errorCode === 'GUS_SESSION_ERROR'
    );
  } else {
    // KRS/CEIDG: Only 5xx
    return statusCode >= 500;
  }
}

// Create retry machine factory using setup() for dependency injection
export const createRetryMachine = (
  service: 'GUS' | 'KRS' | 'CEIDG',
  correlationId: string,
  logger: Logger,
  serviceConfig: ServiceRetryConfig,
) => {

  const initialContext: Omit<RetryContext, 'serviceCall'> = {
    service,
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
      // Stub actor - MUST be overridden via .provide() in parent machine
      makeApiRequest: fromPromise(async () => {
        throw new Error(
          'makeApiRequest actor must be provided via .provide() - this is a stub implementation'
        );
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
          `Scheduling retry for ${context.service}`,
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
          `[${context.correlationId}] Preparing ${context.service} request`,
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
            code: errorCode,
            source: error.source, // Preserve source from BusinessException
            timestamp: new Date(),
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
          `[${context.correlationId}] Starting ${context.service} request (max retries: ${context.maxRetries})`,
        );
      },

      logRetryableError: ({ context }) => {
        logger.warn(
          `[${context.correlationId}] ${context.service} request failed, attempt ${context.attempt}/${context.maxRetries}`,
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
          `[${context.correlationId}] Retrying ${context.service} request, attempt ${context.attempt + 1}/${context.maxRetries}`,
        );
      },

      logSuccess: ({ context }) => {
        logger.debug(
          `[${context.correlationId}] ${context.service} request succeeded on attempt ${context.attempt + 1}`,
        );
      },

      logFinalSuccess: ({ context }) => {
        logger.debug(
          `[${context.correlationId}] ${context.service} retry machine completed successfully`,
        );
      },

      logFinalFailure: ({ context }) => {
        logger.error(
          `[${context.correlationId}] ${context.service} retry machine failed after ${context.attempt} attempts`,
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

        // Check if error can be retried
        if (context.lastError) {
          const shouldRetry = canBeRetriedByService(
            context.lastError,
            context.service
          );

          logger.debug(
            `Can retry ${context.service}?`,
            {
              correlationId: context.correlationId,
              hasAttemptsLeft,
              attempt: context.attempt,
              maxRetries: context.maxRetries,
              shouldRetry,
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
      id: `retry-${service.toLowerCase()}`,
      // XState v5: context can be function or object - use function to accept input
      context: ({ input }: { input?: RetryInput }) => ({
        ...initialContext,
        serviceCall: input?.serviceCall || (() => Promise.reject(new Error('No service call provided'))),
        correlationId: input?.correlationId || correlationId,
        // Pass through all additional input fields (nip, regon, krsNumber, etc.)
        ...(input || {}),
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
              service: context.service,
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
            return context.lastError || {
              message: `${context.service} retry failed`,
              code: 'RETRY_EXHAUSTED',
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
      service: context.service,
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
