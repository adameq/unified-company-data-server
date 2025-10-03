import { Provider } from '@nestjs/common';
import { baseOrchestrationMachine } from './orchestration.machine';

export type { OrchestrationMachineConfig, OrchestrationMachineInput, FullOrchestrationContext } from './orchestration.types';

/**
 * Orchestration Machine Provider Token
 *
 * This token is used for dependency injection of the base orchestration machine.
 * The base machine is configured with stub implementations that will be overridden
 * by OrchestrationService using machine.provide().
 *
 * Usage in OrchestrationService:
 * ```typescript
 * constructor(
 *   @Inject(ORCHESTRATION_MACHINE)
 *   private readonly baseMachine: typeof baseOrchestrationMachine,
 * ) {
 *   this.configuredMachine = this.baseMachine.provide({
 *     actors: {
 *       retryGusClassification: createRetryMachine(...),
 *       // ... other actors
 *     },
 *   });
 * }
 * ```
 */
export const ORCHESTRATION_MACHINE = Symbol('ORCHESTRATION_MACHINE');

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
