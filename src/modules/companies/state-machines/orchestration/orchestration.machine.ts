import { setup, fromPromise } from 'xstate';
import { Logger } from '@nestjs/common';
import {
  OrchestrationContext,
  createInitialContext,
} from '@schemas/orchestration-context.schema';
import {
  OrchestrationMachineConfig,
  OrchestrationMachineInput,
  FullOrchestrationContext,
} from './orchestration.types';
import * as guards from './orchestration.guards';
import * as actions from './orchestration.actions';
import * as states from './orchestration.states';
import type { OrchestrationActionFn } from './xstate-types';

/**
 * Base Orchestration Machine
 *
 * This is the main state machine definition for company data orchestration.
 * It uses XState v5 setup() + createMachine() pattern.
 *
 * Architecture:
 * - Stub actors defined here will be replaced via .provide() in OrchestrationService
 * - Guards, actions, and states are imported from separate modules
 * - Context initialization happens in createMachine()
 *
 * Benefits:
 * - Proper dependency injection (services via .provide())
 * - Easy testing (mock implementations via .provide())
 * - Separation of concerns (guards/actions/states in separate files)
 * - Type safety (TypeScript enforces correct signatures)
 */
export const createOrchestrationMachine = () =>
  setup({
    types: {
      input: {} as OrchestrationMachineInput,
      context: {} as OrchestrationContext & {
        config: OrchestrationMachineConfig;
        logger: Logger;
      },
    },

    /**
     * Stub actors - will be replaced via .provide() in OrchestrationService
     *
     * These are placeholder implementations that throw errors if called directly.
     * OrchestrationService uses .provide() to inject actual retry machine actors.
     */
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

    /**
     * Guards - boolean predicates for state transitions
     *
     * Imported from orchestration.guards.ts
     */
    guards: {
      hasValidClassification: guards.hasValidClassification,
      isLegalEntity: guards.isLegalEntity,
      isIndividualEntrepreneur: guards.isIndividualEntrepreneur,
      isAgriculture: guards.isAgriculture,
      isProfessionalServices: guards.isProfessionalServices,
      isDeregistered: guards.isDeregistered,
      hasEndDate: guards.hasEndDate,
      hasKrsNumber: guards.hasKrsNumber,
      isNotFoundError: guards.isNotFoundError,
    },

    /**
     * Actions - side effects during state transitions
     *
     * Imported from orchestration.actions.ts
     */
    actions: {
      // Logging actions (type assertions solve TS2719 - see xstate-types.d.ts)
      logStateTransition: actions.logStateTransition as OrchestrationActionFn,
      logClassificationSuccess: actions.logClassificationSuccess as OrchestrationActionFn,
      logRoutingToKrs: actions.logRoutingToKrs as OrchestrationActionFn,
      logRoutingToCeidg: actions.logRoutingToCeidg as OrchestrationActionFn,
      logRoutingToGusAgriculture: actions.logRoutingToGusAgriculture as OrchestrationActionFn,
      logRoutingToGusServices: actions.logRoutingToGusServices as OrchestrationActionFn,
      logInactiveCompanyDetected: actions.logInactiveCompanyDetected as OrchestrationActionFn,
      logUnsupportedSilosId: actions.logUnsupportedSilosId as OrchestrationActionFn,
      logKrsNumberFound: actions.logKrsNumberFound as OrchestrationActionFn,
      logKrsNumberMissing: actions.logKrsNumberMissing as OrchestrationActionFn,
      logKrsSuccess: actions.logKrsSuccess as OrchestrationActionFn,
      logKrsPFallbackToS: actions.logKrsPFallbackToS as OrchestrationActionFn,
      logKrsFailureFallbackToGus: actions.logKrsFailureFallbackToGus as OrchestrationActionFn,
      logCeidgSuccess: actions.logCeidgSuccess as OrchestrationActionFn,
      logCeidgFailure: actions.logCeidgFailure as OrchestrationActionFn,
      logGusSuccess: actions.logGusSuccess as OrchestrationActionFn,
      logGusFailure: actions.logGusFailure as OrchestrationActionFn,
      logGusFallbackSuccess: actions.logGusFallbackSuccess as OrchestrationActionFn,
      logGusFallbackFailure: actions.logGusFallbackFailure as OrchestrationActionFn,
      logMappingSuccess: actions.logMappingSuccess as OrchestrationActionFn,
      logFinalSuccess: actions.logFinalSuccess as OrchestrationActionFn,
      logEntityNotFound: actions.logEntityNotFound as OrchestrationActionFn,
      logDeregisteredEntity: actions.logDeregisteredEntity as OrchestrationActionFn,
      logSystemFault: actions.logSystemFault as OrchestrationActionFn,
      logMappingFailure: actions.logMappingFailure as OrchestrationActionFn,
      logTimeoutFailure: actions.logTimeoutFailure as OrchestrationActionFn,

      // Context mutation actions (assign)
      saveClassification: actions.saveClassification as OrchestrationActionFn,
      saveGusData: actions.saveGusData as OrchestrationActionFn,
      extractKrsNumber: actions.extractKrsNumber as OrchestrationActionFn,
      saveKrsData: actions.saveKrsData as OrchestrationActionFn,
      saveCeidgData: actions.saveCeidgData as OrchestrationActionFn,
      saveFinalData: actions.saveFinalData as OrchestrationActionFn,
      captureSystemError: actions.captureSystemError as OrchestrationActionFn,
    },

    /**
     * Delays - timeout configuration
     */
    delays: {
      ORCHESTRATION_TIMEOUT: ({ context }) => context.config.timeouts.total,
    },
  }).createMachine({
    id: 'companyDataOrchestration',
    initial: 'fetchingGusClassification',

    /**
     * Context initialization
     *
     * Merges input (nip, correlationId, config, logger) with initial context.
     */
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

    /**
     * State definitions
     *
     * Imported from orchestration.states.ts
     */
    states: {
      fetchingGusClassification: states.fetchingGusClassification,
      decidingNextStep: states.decidingNextStep,
      fetchingGusFullReportForKrs: states.fetchingGusFullReportForKrs,
      fetchingKrsFromP: states.fetchingKrsFromP,
      fetchingKrsFromS: states.fetchingKrsFromS,
      fetchingCeidgData: states.fetchingCeidgData,
      fetchingGusGenericData: states.fetchingGusGenericData,
      fetchingGusDetailedFallback: states.fetchingGusDetailedFallback,
      mappingInactiveCompany: states.mappingInactiveCompany,
      mappingToUnifiedFormat: states.mappingToUnifiedFormat,
      success: states.success,
      entityNotFoundFailure: states.entityNotFoundFailure,
      deregisteredFailure: states.deregisteredFailure,
      systemFaultFailure: states.systemFaultFailure,
      mappingFailure: states.mappingFailure,
      timeoutFailure: states.timeoutFailure,
    },
  });

/**
 * Export base machine instance
 *
 * This will be used by OrchestrationMachineProvider for NestJS DI.
 */
export const baseOrchestrationMachine = createOrchestrationMachine();
