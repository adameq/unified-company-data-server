import { Logger } from '@nestjs/common';
import { OrchestrationContext } from '@schemas/orchestration-context.schema';

/**
 * Machine configuration interface
 *
 * Defines timeout and retry settings for the orchestration workflow.
 */
export interface OrchestrationMachineConfig {
  timeouts: {
    /**
     * Total orchestration timeout in milliseconds
     * (prevents infinite workflows)
     */
    total: number;

    /**
     * Per-service API call timeout in milliseconds
     * (individual GUS/KRS/CEIDG request timeout)
     */
    perService: number;
  };

  retry: {
    /**
     * GUS API retry configuration
     */
    gus: {
      maxRetries: number;
      initialDelay: number;
    };

    /**
     * KRS API retry configuration
     */
    krs: {
      maxRetries: number;
      initialDelay: number;
    };

    /**
     * CEIDG API retry configuration
     */
    ceidg: {
      maxRetries: number;
      initialDelay: number;
    };
  };
}

/**
 * Input type for machine initialization
 *
 * Passed to createActor() when starting the orchestration workflow.
 */
export interface OrchestrationMachineInput {
  nip: string;
  correlationId: string;
  config: OrchestrationMachineConfig;
  logger: Logger;
}

/**
 * Full context type (base context + injected config/logger)
 *
 * This is the complete context available to guards, actions, and states.
 * Combines OrchestrationContext (data) with runtime config and logger.
 */
export type FullOrchestrationContext = OrchestrationContext & {
  config: OrchestrationMachineConfig;
  logger: Logger;
};
