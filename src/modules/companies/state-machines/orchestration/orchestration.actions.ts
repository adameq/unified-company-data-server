import { assign } from 'xstate';
import { FullOrchestrationContext } from './orchestration.types';

/**
 * Orchestration Machine Actions
 *
 * Actions are side effects that occur during state transitions.
 * They can log messages, update context, or perform other operations.
 *
 * Action categories:
 * - Logging actions: Log state transitions and data flow
 * - Context mutations: Update context with data from events (using assign())
 * - Error handling: Capture and store errors in context
 */

// =============================================================================
// LOGGING ACTIONS
// =============================================================================

export const logStateTransition = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.debug('XState transition', {
    correlationId: context.correlationId,
  });
};

export const logClassificationSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('GUS classification successful', {
    correlationId: context.correlationId,
  });
};

export const logRoutingToKrs = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Routing to KRS (legal entity)', {
    correlationId: context.correlationId,
  });
};

export const logRoutingToCeidg = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Routing to CEIDG (entrepreneur)', {
    correlationId: context.correlationId,
  });
};

export const logRoutingToGusAgriculture = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Routing to GUS (agriculture)', {
    correlationId: context.correlationId,
  });
};

export const logRoutingToGusServices = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Routing to GUS (professional services)', {
    correlationId: context.correlationId,
  });
};

export const logInactiveCompanyDetected = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log(
    'Inactive company detected - fast-fail without additional API calls',
    {
      correlationId: context.correlationId,
      endDate: context.classification?.DataZakonczeniaDzialalnosci,
    },
  );
};

export const logUnsupportedSilosId = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.warn('Unsupported silosId', {
    correlationId: context.correlationId,
    silosId: context.classification?.silosId,
  });
};

export const logKrsNumberFound = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('KRS number found in GUS data', {
    correlationId: context.correlationId,
  });
};

export const logKrsNumberMissing = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('KRS number not found - using GUS-only data', {
    correlationId: context.correlationId,
  });
};

export const logKrsSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('KRS data retrieved successfully', {
    correlationId: context.correlationId,
  });
};

export const logKrsPFallbackToS = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Entity not found in KRS registry P, falling back to registry S', {
    correlationId: context.correlationId,
  });
};

export const logKrsFailureFallbackToGus = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('KRS failed, using GUS detailed data', {
    correlationId: context.correlationId,
  });
};

export const logCeidgSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('CEIDG data retrieved successfully', {
    correlationId: context.correlationId,
  });
};

export const logCeidgFailure = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('CEIDG data retrieval failed', {
    correlationId: context.correlationId,
  });
};

export const logGusSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('GUS detailed data retrieved', {
    correlationId: context.correlationId,
  });
};

export const logGusFailure = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('GUS detailed data failed', {
    correlationId: context.correlationId,
  });
};

export const logGusFallbackSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('GUS fallback data retrieved', {
    correlationId: context.correlationId,
  });
};

export const logGusFallbackFailure = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('GUS fallback failed - no data sources', {
    correlationId: context.correlationId,
  });
};

export const logMappingSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Data mapping completed', {
    correlationId: context.correlationId,
  });
};

export const logFinalSuccess = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.log('Orchestration completed successfully', {
    correlationId: context.correlationId,
  });
};

export const logEntityNotFound = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('Entity not found', {
    correlationId: context.correlationId,
  });
};

export const logDeregisteredEntity = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('Entity is deregistered', {
    correlationId: context.correlationId,
  });
};

export const logSystemFault = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('System fault occurred', {
    correlationId: context.correlationId,
  });
};

export const logMappingFailure = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('Data mapping failed', {
    correlationId: context.correlationId,
  });
};

export const logTimeoutFailure = ({ context }: { context: FullOrchestrationContext }) => {
  context.logger.error('Orchestration timeout exceeded', {
    correlationId: context.correlationId,
    timeoutMs: context.config.timeouts.total,
  });
};

// =============================================================================
// CONTEXT MUTATION ACTIONS (using assign())
// =============================================================================

/**
 * Save GUS classification data to context
 *
 * Normalizes silosId field (handles both SilosID and silosId).
 */
export const saveClassification = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const output = event.output;
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
});

/**
 * Save GUS detailed data to context
 */
export const saveGusData = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const gusData = event.output;
  context.logger.debug('saveGusData', {
    correlationId: context.correlationId,
    hasGusData: !!gusData,
  });
  return {
    ...context,
    gusData,
  };
});

/**
 * Extract KRS number from GUS data and save to context
 *
 * Checks multiple possible field names for KRS number.
 */
export const extractKrsNumber = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const gusData = event.output;
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
});

/**
 * Save KRS data to context
 */
export const saveKrsData = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const krsData = event.output;
  context.logger.debug('saveKrsData', {
    correlationId: context.correlationId,
    hasKrsData: !!krsData,
  });
  return {
    ...context,
    krsData,
  };
});

/**
 * Save CEIDG data to context
 */
export const saveCeidgData = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => ({
  ...context,
  ceidgData: event.output,
}));

/**
 * Save final mapped company data to context
 */
export const saveFinalData = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => ({
  ...context,
  finalCompanyData: event.output,
}));

/**
 * Capture error and save to context
 *
 * Used for error handling in failure states.
 */
export const captureSystemError = assign(({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const error = event.output || event.error;

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
      timestamp: new Date().toISOString(),
      originalError: error,
    },
  };
});
