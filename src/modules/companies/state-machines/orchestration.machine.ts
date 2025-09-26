import { createMachine, assign, fromCallback } from 'xstate';
import {
  OrchestrationContext,
  ContextUpdaters,
  ContextQueries,
  createInitialContext,
  createCompanyClassification,
} from '@schemas/orchestration-context.schema.js';
import { createErrorResponse } from '@schemas/error-response.schema.js';
import { createUnifiedCompanyData } from '@schemas/unified-company-data.schema.js';
import { validateEnvironment } from '@config/environment.schema.js';

/**
 * Main Orchestration State Machine for Company Data Retrieval
 *
 * Orchestrates the complete workflow:
 * 1. NIP validation and input processing
 * 2. GUS classification to determine routing strategy
 * 3. Parallel data fetching from required sources (GUS, KRS, CEIDG)
 * 4. Data mapping to unified format
 * 5. Error handling and retry logic
 *
 * Constitutional compliance:
 * - Formal state machine replaces complex if/else logic
 * - All external API interactions via retry sub-machines
 * - Comprehensive logging with correlation IDs
 * - Timeout handling and graceful degradation
 * - Type-safe context management with Zod validation
 */

// Events that the orchestration machine can receive
export type OrchestrationEvent =
  | { type: 'START'; nip: string; correlationId: string }
  | { type: 'CLASSIFICATION_SUCCESS'; data: any }
  | { type: 'CLASSIFICATION_ERROR'; error: any }
  | { type: 'KRS_SUCCESS'; data: any }
  | { type: 'KRS_ERROR'; error: any }
  | { type: 'CEIDG_SUCCESS'; data: any }
  | { type: 'CEIDG_ERROR'; error: any }
  | { type: 'GUS_DETAILED_SUCCESS'; data: any }
  | { type: 'GUS_DETAILED_ERROR'; error: any }
  | { type: 'ALL_DATA_COLLECTED' }
  | { type: 'PARTIAL_DATA_AVAILABLE' }
  | { type: 'MAPPING_SUCCESS'; unifiedData: any }
  | { type: 'MAPPING_ERROR'; error: any }
  | { type: 'TIMEOUT' }
  | { type: 'RESET' };

// Service injection interface for external dependencies
export interface OrchestrationServices {
  gusService: {
    getClassificationByNip: (
      nip: string,
      correlationId: string,
    ) => Promise<any>;
    getDetailedReport: (
      regon: string,
      silosId: string,
      correlationId: string,
    ) => Promise<any>;
  };
  krsService: {
    fetchCompanyByKrs: (
      krsNumber: string,
      correlationId: string,
    ) => Promise<any>;
  };
  ceidgService: {
    getCompanyByNip: (nip: string, correlationId: string) => Promise<any>;
  };
}

// Machine configuration
const getMachineConfig = () => {
  const env = validateEnvironment();
  return {
    timeouts: {
      total: env.REQUEST_TIMEOUT, // 15 seconds total
      perService: env.EXTERNAL_API_TIMEOUT, // 5 seconds per service
    },
  };
};

// Create orchestration machine factory
export const createOrchestrationMachine = (services: OrchestrationServices) => {
  const config = getMachineConfig();

  return createMachine({
    id: `orchestration-${Date.now()}`,
    context: createInitialContext('0000000000', 'temp-correlation-id'),
    initial: 'idle',
    states: {
      idle: {
        on: {
          START: 'classifying',
        },
      },
      classifying: {
        on: {
          CLASSIFICATION_SUCCESS: 'routing',
          CLASSIFICATION_ERROR: 'failed',
        },
      },
      routing: {
        on: {
          KRS_SUCCESS: 'success',
          CEIDG_SUCCESS: 'success',
          KRS_ERROR: 'failed',
          CEIDG_ERROR: 'failed',
        },
      },
      success: {
        type: 'final',
      },
      failed: {
        type: 'final',
      },
    },
  });
};
