import { FullOrchestrationContext } from './orchestration.types';

/**
 * Orchestration Machine States
 *
 * State definitions for the company data orchestration workflow.
 * Each state represents a step in the data retrieval and mapping process.
 *
 * State categories:
 * - Data fetching states: Fetch data from external APIs (GUS, KRS, CEIDG)
 * - Decision states: Determine routing based on classification
 * - Mapping states: Transform raw API data to unified format
 * - Final states: Success or failure terminal states
 */

/**
 * Fetching GUS classification (initial state)
 *
 * Retrieves basic classification data from GUS to determine entity type.
 */
export const fetchingGusClassification = {
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
} as const;

/**
 * Deciding next step based on classification
 *
 * Routes workflow to appropriate data source based on silosId.
 */
export const decidingNextStep = {
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
} as const;

/**
 * Fetching GUS full report for legal entities
 *
 * Retrieves detailed GUS data including KRS number for legal entities.
 */
export const fetchingGusFullReportForKrs = {
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
} as const;

/**
 * Fetching KRS data from registry P (primary)
 *
 * Attempts to retrieve KRS data from registry P.
 * Falls back to registry S if entity not found in P.
 */
export const fetchingKrsFromP = {
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
        guard: ({ event }: { event: any }) => {
          const error = (event as any).error;
          // Check BusinessException errorCode for ENTITY_NOT_FOUND
          // All services throw standardized BusinessException
          return error?.errorCode === 'ENTITY_NOT_FOUND';
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
} as const;

/**
 * Fetching KRS data from registry S (fallback)
 *
 * Fallback attempt to retrieve KRS data from registry S.
 * Used when entity not found in registry P.
 */
export const fetchingKrsFromS = {
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
} as const;

/**
 * Fetching CEIDG data for individual entrepreneurs
 *
 * Retrieves data from CEIDG API for silosId=1 entities.
 * Falls back to GUS if CEIDG fails.
 */
export const fetchingCeidgData = {
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
} as const;

/**
 * Fetching GUS generic data
 *
 * Retrieves detailed GUS data for entities that don't need KRS/CEIDG
 * (agriculture, professional services).
 */
export const fetchingGusGenericData = {
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
} as const;

/**
 * Fetching GUS detailed data (fallback)
 *
 * Fallback state when CEIDG fails for entrepreneurs.
 * Uses GUS data as last resort.
 */
export const fetchingGusDetailedFallback = {
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
} as const;

/**
 * Mapping inactive company data
 *
 * Special mapping for companies with end date (closed businesses).
 * Skips additional API calls for efficiency.
 */
export const mappingInactiveCompany = {
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
} as const;

/**
 * Mapping to unified format
 *
 * Main mapping state - transforms all collected data to UnifiedCompanyData format.
 */
export const mappingToUnifiedFormat = {
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
} as const;

/**
 * Success state (final)
 *
 * Terminal state indicating successful data retrieval and mapping.
 * Returns finalCompanyData as output.
 */
export const success = {
  type: 'final' as const,
  entry: 'logFinalSuccess',
  output: ({ context }: { context: FullOrchestrationContext }) => context.finalCompanyData,
} as const;

/**
 * Entity not found failure (final)
 *
 * Terminal state for 404 errors from external APIs.
 */
export const entityNotFoundFailure = {
  type: 'final' as const,
  entry: 'logEntityNotFound',
  output: ({ context }: { context: FullOrchestrationContext }) =>
    context.lastError || {
      errorCode: 'ENTITY_NOT_FOUND',
      message: 'Entity not found',
      correlationId: context.correlationId,
      source: 'INTERNAL',
    },
} as const;

/**
 * Deregistered entity failure (final)
 *
 * Terminal state for entities with silosId=4 (deregistered).
 */
export const deregisteredFailure = {
  type: 'final' as const,
  entry: 'logDeregisteredEntity',
  output: ({ context }: { context: FullOrchestrationContext }) =>
    context.lastError || {
      errorCode: 'ENTITY_DEREGISTERED',
      message: 'Entity is deregistered',
      correlationId: context.correlationId,
      source: 'INTERNAL',
    },
} as const;

/**
 * System fault failure (final)
 *
 * Terminal state for unexpected errors from external APIs.
 */
export const systemFaultFailure = {
  type: 'final' as const,
  entry: 'logSystemFault',
  output: ({ context }: { context: FullOrchestrationContext }) =>
    context.lastError || {
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'System fault occurred',
      correlationId: context.correlationId,
      source: 'INTERNAL',
    },
} as const;

/**
 * Mapping failure (final)
 *
 * Terminal state for data mapping errors.
 */
export const mappingFailure = {
  type: 'final' as const,
  entry: 'logMappingFailure',
  output: ({ context }: { context: FullOrchestrationContext }) =>
    context.lastError || {
      errorCode: 'DATA_MAPPING_FAILED',
      message: 'Data mapping failed',
      correlationId: context.correlationId,
      source: 'INTERNAL',
    },
} as const;

/**
 * Timeout failure (final)
 *
 * Terminal state for orchestration timeout.
 */
export const timeoutFailure = {
  type: 'final' as const,
  entry: 'logTimeoutFailure',
  output: ({ context }: { context: FullOrchestrationContext }) => ({
    errorCode: 'TIMEOUT_ERROR',
    message: 'Company data retrieval timed out',
    correlationId: context.correlationId,
    source: 'INTERNAL',
  }),
} as const;
