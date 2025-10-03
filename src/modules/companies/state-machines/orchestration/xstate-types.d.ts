import type { ActionFunction } from 'xstate';
import type { FullOrchestrationContext } from './orchestration.types';

/**
 * Unified type alias for XState ActionFunction
 *
 * Solves TS2719 "Two different types with this name exist, but they are unrelated"
 *
 * Root cause: TypeScript creates distinct type identities for conditional types
 * (ActionFunction<...>) even from the same module when imported across boundaries.
 *
 * Solution: Named type alias forces TypeScript to treat all actions as the same type.
 *
 * Reference: microsoft/TypeScript#26627 (conditional types with inference positions)
 */
export type OrchestrationActionFn = ActionFunction<
  FullOrchestrationContext,
  any, // events
  any, // actors
  any, // guards
  any  // delays
>;
