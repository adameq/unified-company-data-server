import { createMachine, assign, fromCallback } from 'xstate';
import { z } from 'zod';
import { validateEnvironment } from '@config/environment.schema.js';

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
 */

// Retry context schema for validation
const RetryContextSchema = z.object({
  service: z.enum(['GUS', 'KRS', 'CEIDG']),
  attempt: z.number().min(0),
  maxRetries: z.number().min(1).max(5),
  initialDelay: z.number().min(50).max(2000),
  correlationId: z.string().uuid(),
  lastError: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      timestamp: z.date(),
    })
    .optional(),
});

export type RetryContext = z.infer<typeof RetryContextSchema>;

// Events that the retry machine can receive
export type RetryEvent =
  | { type: 'REQUEST'; payload: any }
  | { type: 'SUCCESS'; data: any }
  | { type: 'FAILURE'; error: { message: string; code?: string } }
  | { type: 'RETRY_TIMEOUT' }
  | { type: 'RESET' };

// Service configuration per external API
interface ServiceRetryConfig {
  maxRetries: number;
  initialDelay: number;
}

const getServiceConfig = (): Record<
  'GUS' | 'KRS' | 'CEIDG',
  ServiceRetryConfig
> => {
  const env = validateEnvironment();
  return {
    GUS: {
      maxRetries: env.GUS_MAX_RETRIES,
      initialDelay: env.GUS_INITIAL_DELAY,
    },
    KRS: {
      maxRetries: env.KRS_MAX_RETRIES,
      initialDelay: env.KRS_INITIAL_DELAY,
    },
    CEIDG: {
      maxRetries: env.CEIDG_MAX_RETRIES,
      initialDelay: env.CEIDG_INITIAL_DELAY,
    },
  };
};

// Calculate exponential backoff delay with jitter
const calculateBackoffDelay = (
  attempt: number,
  initialDelay: number,
  maxDelay = 5000,
): number => {
  const exponentialDelay = initialDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelay);
  return Math.round(delay);
};

// Create retry machine factory
export const createRetryMachine = (
  service: 'GUS' | 'KRS' | 'CEIDG',
  correlationId: string,
) => {
  const serviceConfig = getServiceConfig()[service];

  const initialContext: RetryContext = {
    service,
    attempt: 0,
    maxRetries: serviceConfig.maxRetries,
    initialDelay: serviceConfig.initialDelay,
    correlationId,
  };

  return createMachine(
    {
      /** @xstate-layout N4IgpgJg5mDOIC5QGMCGA7ArgJ0gSwAsBjAOygFcBjAegBVylsQIBJlrA92w5w20 */
      id: `retry-${service.toLowerCase()}`,
      context: initialContext,
      initial: 'idle',
      states: {
        idle: {
          description: 'Waiting for request to start',
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
          description: 'Making the actual API request',
          invoke: {
            id: 'apiRequest',
            src: 'makeApiRequest',
            onDone: {
              target: 'success',
              actions: ['logSuccess'],
            },
            onError: [
              {
                target: 'retrying',
                guard: 'canRetry',
                actions: ['incrementAttempt', 'logRetryableError'],
              },
              {
                target: 'failed',
                actions: ['logFinalFailure'],
              },
            ],
          },
          on: {
            SUCCESS: {
              target: 'success',
              actions: ['logSuccess'],
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
        },

        failed: {
          description: 'Request failed after all retries exhausted',
          type: 'final',
          entry: ['logFinalFailure'],
        },
      },
    },
    {
      actions: {
        prepareRequest: assign(({ context, event }) => {
          console.log(
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
          const error =
            'error' in event ? event.error : { message: 'Unknown error' };
          return {
            ...context,
            lastError: {
              message: error.message,
              code: error.code,
              timestamp: new Date(),
            },
          };
        }),

        resetContext: assign(({ context }) => {
          return {
            ...context,
            attempt: 0,
            lastError: undefined,
          };
        }),

        logRequestStart: ({ context }) => {
          console.log(
            `[${context.correlationId}] Starting ${context.service} request (max retries: ${context.maxRetries})`,
          );
        },

        logRetryableError: ({ context }) => {
          console.warn(
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
          console.log(
            `[${context.correlationId}] Retrying ${context.service} request, attempt ${context.attempt + 1}/${context.maxRetries}`,
          );
        },

        logSuccess: ({ context }) => {
          console.log(
            `[${context.correlationId}] ${context.service} request succeeded on attempt ${context.attempt + 1}`,
          );
        },

        logFinalSuccess: ({ context }) => {
          console.log(
            `[${context.correlationId}] ${context.service} retry machine completed successfully`,
          );
        },

        logFinalFailure: ({ context }) => {
          console.error(
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
          const canRetry = context.attempt < context.maxRetries;
          console.log(
            `[${context.correlationId}] Can retry ${context.service}? ${canRetry} (${context.attempt}/${context.maxRetries})`,
          );
          return canRetry;
        },
      },

      actors: {
        makeApiRequest: fromCallback(({ sendBack, receive, input }) => {
          // This will be implemented by the parent machine
          // The actual API call logic is injected from outside
          console.log(
            'API request actor invoked - should be overridden by parent machine',
          );

          // Simulate async API call
          const timeout = setTimeout(() => {
            sendBack({ type: 'SUCCESS', data: 'mock-success' });
          }, 100);

          return () => {
            clearTimeout(timeout);
          };
        }),

        scheduleRetry: fromCallback(({ sendBack, receive, input }) => {
          const context = input as RetryContext;
          const delay = calculateBackoffDelay(
            context.attempt,
            context.initialDelay,
          );

          console.log(
            `[${context.correlationId}] Scheduling ${context.service} retry in ${delay}ms`,
          );

          const timeout = setTimeout(() => {
            sendBack({ type: 'RETRY_TIMEOUT' });
          }, delay);

          return () => {
            clearTimeout(timeout);
          };
        }),
      },
    },
  );
};

// Utility functions for working with retry machines
export const RetryMachineUtils = {
  /**
   * Create a retry machine for a specific service
   */
  createForService: (
    service: 'GUS' | 'KRS' | 'CEIDG',
    correlationId: string,
  ) => {
    return createRetryMachine(service, correlationId);
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
