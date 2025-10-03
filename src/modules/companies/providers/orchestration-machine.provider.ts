import { Provider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { setup, fromPromise, assign } from 'xstate';
import {
  OrchestrationContext,
  createInitialContext,
} from '@schemas/orchestration-context.schema';
import { createRetryMachine } from '../state-machines/retry.machine';

/**
 * Orchestration Machine Provider Token
 *
 * This token is used for dependency injection of the base orchestration machine.
 * The base machine is configured with stub implementations that will be overridden
 * by OrchestrationService using machine.provide().
 */
export const ORCHESTRATION_MACHINE = Symbol('ORCHESTRATION_MACHINE');

/**
 * Machine configuration interface
 */
export interface OrchestrationMachineConfig {
  timeouts: {
    total: number;
    perService: number;
  };
  retry: {
    gus: { maxRetries: number; initialDelay: number };
    krs: { maxRetries: number; initialDelay: number };
    ceidg: { maxRetries: number; initialDelay: number };
  };
}

/**
 * Input type for machine
 */
export interface OrchestrationMachineInput {
  nip: string;
  correlationId: string;
  config: OrchestrationMachineConfig;
  logger: Logger;
}

/**
 * Full context type (base context + injected config/logger)
 */
type FullOrchestrationContext = OrchestrationContext & {
  config: OrchestrationMachineConfig;
  logger: Logger;
};


/**
 * Base Orchestration Machine (stub implementations)
 *
 * This machine definition uses setup() to define types and stub actors.
 * Concrete implementations are injected via machine.provide() in OrchestrationService.
 *
 * Benefits of this approach:
 * - Proper dependency injection (services injected via .provide())
 * - Easy testing (mock implementations via .provide())
 * - Separation of concerns (state logic vs external dependencies)
 * - Type safety (TypeScript enforces correct signatures)
 */
export const baseOrchestrationMachine = setup({
  types: {
    input: {} as OrchestrationMachineInput,
    context: {} as OrchestrationContext & {
      config: OrchestrationMachineConfig;
      logger: Logger;
    },
  },

  // Stub actors - retry machines will be provided by .provide() in OrchestrationService
  // These are placeholders that will be replaced with actual retry machine implementations
  actors: {
    retryGusClassification: fromPromise<any, any>(async () => {
      throw new Error('retryGusClassification not implemented - use .provide()');
    }),

    retryGusDetailedData: fromPromise<any, any>(async () => {
      throw new Error('retryGusDetailedData not implemented - use .provide()');
    }),

    retryKrsData: fromPromise<any, any>(async () => {
      throw new Error('retryKrsData not implemented - use .provide()');
    }),

    retryCeidgData: fromPromise<any, any>(async () => {
      throw new Error('retryCeidgData not implemented - use .provide()');
    }),

    mapInactiveCompany: fromPromise<any, OrchestrationContext>(async () => {
      throw new Error('mapInactiveCompany not implemented - use .provide()');
    }),

    mapToUnifiedFormat: fromPromise<any, OrchestrationContext>(async () => {
      throw new Error('mapToUnifiedFormat not implemented - use .provide()');
    }),
  },

  // Guards (don't depend on external services)
  guards: {
    hasValidClassification: ({ context, event }) => {
      const classification = (event as any).output;
      if (!classification) {
        return false;
      }
      const regon = classification.Regon || classification.regon;
      const silosId = classification.SilosID || classification.silosId;
      return !!(regon && silosId);
    },

    isLegalEntity: ({ context }) => {
      return context.classification?.silosId === '6';
    },

    isIndividualEntrepreneur: ({ context }) => {
      return context.classification?.silosId === '1';
    },

    isAgriculture: ({ context }) => {
      return context.classification?.silosId === '2';
    },

    isProfessionalServices: ({ context }) => {
      return context.classification?.silosId === '3';
    },

    isDeregistered: ({ context }) => {
      return context.classification?.silosId === '4';
    },

    hasEndDate: ({ context }) => {
      return !!context.classification?.DataZakonczeniaDzialalnosci;
    },

    hasKrsNumber: ({ context, event }) => {
      const gusData = (event as any).output;
      if (!gusData) {
        return false;
      }
      const krsNumber =
        gusData?.praw_numerWRejestrzeEwidencji ||
        gusData?.praw_krs ||
        gusData?.krs;
      return !!krsNumber;
    },

    isNotFoundError: ({ context, event }) => {
      const error = (event as any).output || (event as any).error;
      const errorCode = error?.errorCode || error?.code;
      const statusCode = error?.status || error?.statusCode;

      return (
        errorCode === 'ENTITY_NOT_FOUND' ||
        statusCode === 404 ||
        error?.message?.includes('not found') ||
        error?.message?.includes('Not Found')
      );
    },
  },

  // Actions (use logger from context)
  actions: {
    logStateTransition: ({ context }) => {
      context.logger.debug('XState transition', {
        correlationId: context.correlationId,
      });
    },

    logClassificationSuccess: ({ context }) => {
      context.logger.log('GUS classification successful', {
        correlationId: context.correlationId,
      });
    },

    logRoutingToKrs: ({ context }) => {
      context.logger.log('Routing to KRS (legal entity)', {
        correlationId: context.correlationId,
      });
    },

    logRoutingToCeidg: ({ context }) => {
      context.logger.log('Routing to CEIDG (entrepreneur)', {
        correlationId: context.correlationId,
      });
    },

    logRoutingToGusAgriculture: ({ context }) => {
      context.logger.log('Routing to GUS (agriculture)', {
        correlationId: context.correlationId,
      });
    },

    logRoutingToGusServices: ({ context }) => {
      context.logger.log('Routing to GUS (professional services)', {
        correlationId: context.correlationId,
      });
    },

    logInactiveCompanyDetected: ({ context }) => {
      context.logger.log(
        'Inactive company detected - fast-fail without additional API calls',
        {
          correlationId: context.correlationId,
          endDate: context.classification?.DataZakonczeniaDzialalnosci,
        },
      );
    },

    logUnsupportedSilosId: ({ context }) => {
      context.logger.warn('Unsupported silosId', {
        correlationId: context.correlationId,
        silosId: context.classification?.silosId,
      });
    },

    logKrsNumberFound: ({ context }) => {
      context.logger.log('KRS number found in GUS data', {
        correlationId: context.correlationId,
      });
    },

    logKrsNumberMissing: ({ context }) => {
      context.logger.log('KRS number not found - using GUS-only data', {
        correlationId: context.correlationId,
      });
    },

    logKrsSuccess: ({ context }) => {
      context.logger.log('KRS data retrieved successfully', {
        correlationId: context.correlationId,
      });
    },

    logKrsPFallbackToS: ({ context }) => {
      context.logger.log('Entity not found in KRS registry P, falling back to registry S', {
        correlationId: context.correlationId,
      });
    },

    logKrsFailureFallbackToGus: ({ context }) => {
      context.logger.log('KRS failed, using GUS detailed data', {
        correlationId: context.correlationId,
      });
    },

    logCeidgSuccess: ({ context }) => {
      context.logger.log('CEIDG data retrieved successfully', {
        correlationId: context.correlationId,
      });
    },

    logCeidgFailure: ({ context }) => {
      context.logger.error('CEIDG data retrieval failed', {
        correlationId: context.correlationId,
      });
    },

    logGusSuccess: ({ context }) => {
      context.logger.log('GUS detailed data retrieved', {
        correlationId: context.correlationId,
      });
    },

    logGusFailure: ({ context }) => {
      context.logger.error('GUS detailed data failed', {
        correlationId: context.correlationId,
      });
    },

    logGusFallbackSuccess: ({ context }) => {
      context.logger.log('GUS fallback data retrieved', {
        correlationId: context.correlationId,
      });
    },

    logGusFallbackFailure: ({ context }) => {
      context.logger.error('GUS fallback failed - no data sources', {
        correlationId: context.correlationId,
      });
    },

    logMappingSuccess: ({ context }) => {
      context.logger.log('Data mapping completed', {
        correlationId: context.correlationId,
      });
    },

    logFinalSuccess: ({ context }) => {
      context.logger.log('Orchestration completed successfully', {
        correlationId: context.correlationId,
      });
    },

    logEntityNotFound: ({ context }) => {
      context.logger.error('Entity not found', {
        correlationId: context.correlationId,
      });
    },

    logDeregisteredEntity: ({ context }) => {
      context.logger.error('Entity is deregistered', {
        correlationId: context.correlationId,
      });
    },

    logSystemFault: ({ context }) => {
      context.logger.error('System fault occurred', {
        correlationId: context.correlationId,
      });
    },

    logMappingFailure: ({ context }) => {
      context.logger.error('Data mapping failed', {
        correlationId: context.correlationId,
      });
    },

    logTimeoutFailure: ({ context }) => {
      context.logger.error('Orchestration timeout exceeded', {
        correlationId: context.correlationId,
        timeoutMs: context.config.timeouts.total,
      });
    },

    saveClassification: assign(({ context, event }) => {
      const output = (event as any).output;
      context.logger.debug('saveClassification', {
        correlationId: context.correlationId,
        output,
      });

      const normalizedClassification = {
        ...output,
        silosId: output.SilosID || output.silosId,
      };

      return {
        ...context,
        classification: normalizedClassification,
      };
    }),

    saveGusData: assign(({ context, event }) => {
      const gusData = (event as any).output;
      context.logger.debug('saveGusData', {
        correlationId: context.correlationId,
        hasGusData: !!gusData,
      });
      return {
        ...context,
        gusData,
      };
    }),

    extractKrsNumber: assign(({ context, event }) => {
      const gusData = (event as any).output;
      const krsNumber =
        gusData?.praw_numerWRejestrzeEwidencji ||
        gusData?.praw_krs ||
        gusData?.krs;
      context.logger.debug('extractKrsNumber', {
        correlationId: context.correlationId,
        krsNumber,
      });
      return {
        ...context,
        krsNumber,
      };
    }),

    saveKrsData: assign(({ context, event }) => {
      const krsData = (event as any).output;
      context.logger.debug('saveKrsData', {
        correlationId: context.correlationId,
        hasKrsData: !!krsData,
      });
      return {
        ...context,
        krsData,
      };
    }),

    saveCeidgData: assign(({ context, event }) => ({
      ...context,
      ceidgData: (event as any).output,
    })),

    saveFinalData: assign(({ context, event }) => ({
      ...context,
      finalCompanyData: (event as any).output,
    })),

    captureSystemError: assign(({ context, event }) => {
      const error = (event as any).output || (event as any).error;

      context.logger.error('captureSystemError', {
        correlationId: context.correlationId,
        errorCode: error?.errorCode || error?.code,
        errorMessage: error?.message,
      });

      return {
        ...context,
        lastError: {
          errorCode: error?.errorCode || error?.code || 'ORCHESTRATION_FAILED',
          message: error?.message || 'Unknown system error',
          correlationId: context.correlationId,
          source: error?.source || 'INTERNAL',
          timestamp: new Date(),
          originalError: error,
        },
      };
    }),
  },

  // Delays use config from context
  delays: {
    ORCHESTRATION_TIMEOUT: ({ context }) => context.config.timeouts.total,
  },
}).createMachine({
  id: 'companyDataOrchestration',
  initial: 'fetchingGusClassification',

  context: ({ input }) => {
    const { nip, correlationId, config, logger } = input;

    logger.debug('Orchestration machine config received', {
      totalTimeout: config.timeouts.total,
      perServiceTimeout: config.timeouts.perService,
    });

    return {
      ...createInitialContext(nip, correlationId),
      config,
      logger,
    };
  },

  states: {
    // State definitions will be in separate file due to length
    // Import from orchestration.machine.states.ts
    fetchingGusClassification: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: {
          target: 'timeoutFailure',
        },
      },
      invoke: {
        id: 'gusClassification',
        src: 'retryGusClassification',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          nip: context.nip,
          correlationId: context.correlationId,
        }),
        onDone: [
          {
            target: 'decidingNextStep',
            guard: 'hasValidClassification',
            actions: ['saveClassification', 'logClassificationSuccess'],
          },
        ],
        onError: [
          {
            target: 'entityNotFoundFailure',
            guard: 'isNotFoundError',
            actions: ['captureSystemError', 'logEntityNotFound'],
          },
          {
            target: 'systemFaultFailure',
            actions: ['captureSystemError', 'logSystemFault'],
          },
        ],
      },
    },

    decidingNextStep: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      always: [
        {
          target: 'mappingInactiveCompany',
          guard: 'hasEndDate',
          actions: 'logInactiveCompanyDetected',
        },
        {
          target: 'fetchingCeidgData',
          guard: 'isIndividualEntrepreneur',
          actions: 'logRoutingToCeidg',
        },
        {
          target: 'fetchingGusGenericData',
          guard: 'isAgriculture',
          actions: 'logRoutingToGusAgriculture',
        },
        {
          target: 'fetchingGusGenericData',
          guard: 'isProfessionalServices',
          actions: 'logRoutingToGusServices',
        },
        {
          target: 'deregisteredFailure',
          guard: 'isDeregistered',
          actions: 'logDeregisteredEntity',
        },
        {
          target: 'fetchingGusFullReportForKrs',
          guard: 'isLegalEntity',
          actions: 'logRoutingToKrs',
        },
        {
          target: 'systemFaultFailure',
          actions: 'logUnsupportedSilosId',
        },
      ],
    },

    fetchingGusFullReportForKrs: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'gusFullReport',
        src: 'retryGusDetailedData',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          regon: context.classification!.Regon,
          silosId: context.classification!.silosId || context.classification!.SilosID,
          correlationId: context.correlationId,
        }),
        onDone: [
          {
            target: 'fetchingKrsFromP',
            guard: 'hasKrsNumber',
            actions: ['saveGusData', 'extractKrsNumber', 'logKrsNumberFound'],
          },
          {
            target: 'mappingToUnifiedFormat',
            actions: ['saveGusData', 'logKrsNumberMissing'],
          },
        ],
        onError: {
          target: 'systemFaultFailure',
          actions: ['captureSystemError', 'logSystemFault'],
        },
      },
    },

    fetchingKrsFromP: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'krsDataFromP',
        src: 'retryKrsData',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          krsNumber: context.krsNumber,
          registry: 'P' as const,
          correlationId: context.correlationId,
        }),
        onDone: {
          target: 'mappingToUnifiedFormat',
          actions: ['saveKrsData', 'logKrsSuccess'],
        },
        onError: [
          {
            guard: ({ event }) => {
              const error = (event as any).error;
              return error?.code === 'ENTITY_NOT_FOUND' || error?.errorCode === 'ENTITY_NOT_FOUND' || error?.response?.status === 404;
            },
            target: 'fetchingKrsFromS',
            actions: ['captureSystemError', 'logKrsPFallbackToS'],
          },
          {
            target: 'mappingToUnifiedFormat',
            actions: ['captureSystemError', 'logKrsFailureFallbackToGus'],
          },
        ],
      },
    },

    fetchingKrsFromS: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'krsDataFromS',
        src: 'retryKrsData',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          krsNumber: context.krsNumber,
          registry: 'S' as const,
          correlationId: context.correlationId,
        }),
        onDone: {
          target: 'mappingToUnifiedFormat',
          actions: ['saveKrsData', 'logKrsSuccess'],
        },
        onError: {
          target: 'mappingToUnifiedFormat',
          actions: ['captureSystemError', 'logKrsFailureFallbackToGus'],
        },
      },
    },

    fetchingCeidgData: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'ceidgData',
        src: 'retryCeidgData',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          nip: context.nip,
          correlationId: context.correlationId,
        }),
        onDone: {
          target: 'mappingToUnifiedFormat',
          actions: ['saveCeidgData', 'logCeidgSuccess'],
        },
        onError: {
          target: 'fetchingGusDetailedFallback',
          actions: ['captureSystemError', 'logCeidgFailure'],
        },
      },
    },

    fetchingGusGenericData: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'gusGenericData',
        src: 'retryGusDetailedData',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          regon: context.classification!.Regon,
          silosId: context.classification!.silosId || context.classification!.SilosID,
          correlationId: context.correlationId,
        }),
        onDone: {
          target: 'mappingToUnifiedFormat',
          actions: ['saveGusData', 'logGusSuccess'],
        },
        onError: {
          target: 'systemFaultFailure',
          actions: ['captureSystemError', 'logGusFailure'],
        },
      },
    },

    fetchingGusDetailedFallback: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'gusDetailedFallback',
        src: 'retryGusDetailedData',
        input: ({ context }: { context: FullOrchestrationContext }) => ({
          regon: context.classification!.Regon,
          silosId: context.classification!.silosId || context.classification!.SilosID,
          correlationId: context.correlationId,
        }),
        onDone: {
          target: 'mappingToUnifiedFormat',
          actions: ['saveGusData', 'logGusFallbackSuccess'],
        },
        onError: {
          target: 'systemFaultFailure',
          actions: ['captureSystemError', 'logGusFallbackFailure'],
        },
      },
    },

    mappingInactiveCompany: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'inactiveMapping',
        src: 'mapInactiveCompany',
        input: ({ context }: { context: FullOrchestrationContext }) => context,
        onDone: {
          target: 'success',
          actions: ['saveFinalData', 'logMappingSuccess'],
        },
        onError: {
          target: 'mappingFailure',
          actions: ['captureSystemError', 'logMappingFailure'],
        },
      },
    },

    mappingToUnifiedFormat: {
      entry: 'logStateTransition',
      after: {
        ORCHESTRATION_TIMEOUT: 'timeoutFailure',
      },
      invoke: {
        id: 'dataMapping',
        src: 'mapToUnifiedFormat',
        input: ({ context }: { context: FullOrchestrationContext }) => context,
        onDone: {
          target: 'success',
          actions: ['saveFinalData', 'logMappingSuccess'],
        },
        onError: {
          target: 'mappingFailure',
          actions: ['captureSystemError', 'logMappingFailure'],
        },
      },
    },

    success: {
      type: 'final',
      entry: 'logFinalSuccess',
      output: ({ context }) => context.finalCompanyData,
    },

    entityNotFoundFailure: {
      type: 'final',
      entry: 'logEntityNotFound',
      output: ({ context }) =>
        context.lastError || {
          errorCode: 'ENTITY_NOT_FOUND',
          message: 'Entity not found',
          correlationId: context.correlationId,
          source: 'INTERNAL',
        },
    },

    deregisteredFailure: {
      type: 'final',
      entry: 'logDeregisteredEntity',
      output: ({ context }) =>
        context.lastError || {
          errorCode: 'ENTITY_DEREGISTERED',
          message: 'Entity is deregistered',
          correlationId: context.correlationId,
          source: 'INTERNAL',
        },
    },

    systemFaultFailure: {
      type: 'final',
      entry: 'logSystemFault',
      output: ({ context }) =>
        context.lastError || {
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'System fault occurred',
          correlationId: context.correlationId,
          source: 'INTERNAL',
        },
    },

    mappingFailure: {
      type: 'final',
      entry: 'logMappingFailure',
      output: ({ context }) =>
        context.lastError || {
          errorCode: 'DATA_MAPPING_FAILED',
          message: 'Data mapping failed',
          correlationId: context.correlationId,
          source: 'INTERNAL',
        },
    },

    timeoutFailure: {
      type: 'final',
      entry: 'logTimeoutFailure',
      output: ({ context }) => ({
        errorCode: 'TIMEOUT_ERROR',
        message: 'Company data retrieval timed out',
        correlationId: context.correlationId,
        source: 'INTERNAL',
      }),
    },
  },
});

/**
 * Provider for base orchestration machine
 *
 * This provider registers the base machine in NestJS dependency injection container.
 * OrchestrationService will inject this and use .provide() to supply concrete implementations.
 */
export const OrchestrationMachineProvider: Provider = {
  provide: ORCHESTRATION_MACHINE,
  useValue: baseOrchestrationMachine,
};
