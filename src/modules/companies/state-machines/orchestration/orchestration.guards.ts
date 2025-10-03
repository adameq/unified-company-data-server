import { FullOrchestrationContext } from './orchestration.types';

/**
 * Orchestration Machine Guards
 *
 * Guards are boolean predicates that control state transitions.
 * They determine which path the state machine should take based on context and event data.
 *
 * Guard naming convention:
 * - has*: Checks for presence of data (hasValidClassification, hasKrsNumber)
 * - is*: Checks entity type or condition (isLegalEntity, isNotFoundError)
 */

/**
 * Check if GUS classification response has valid data
 *
 * Valid classification must contain both regon and silosId.
 */
export const hasValidClassification = ({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const classification = event.output;
  if (!classification) {
    return false;
  }
  const regon = classification.Regon || classification.regon;
  const silosId = classification.SilosID || classification.silosId;
  return !!(regon && silosId);
};

/**
 * Check if entity is a legal entity (silosId = '6')
 *
 * Legal entities require KRS lookup for additional data.
 */
export const isLegalEntity = ({ context }: { context: FullOrchestrationContext }) => {
  return context.classification?.silosId === '6';
};

/**
 * Check if entity is an individual entrepreneur (silosId = '1')
 *
 * Individual entrepreneurs require CEIDG lookup for additional data.
 */
export const isIndividualEntrepreneur = ({ context }: { context: FullOrchestrationContext }) => {
  return context.classification?.silosId === '1';
};

/**
 * Check if entity is agriculture (silosId = '2')
 *
 * Agriculture entities only use GUS data (no KRS/CEIDG).
 */
export const isAgriculture = ({ context }: { context: FullOrchestrationContext }) => {
  return context.classification?.silosId === '2';
};

/**
 * Check if entity is professional services (silosId = '3')
 *
 * Professional services only use GUS data (no KRS/CEIDG).
 */
export const isProfessionalServices = ({ context }: { context: FullOrchestrationContext }) => {
  return context.classification?.silosId === '3';
};

/**
 * Check if entity is deregistered (silosId = '4')
 *
 * Deregistered entities only use GUS data (no KRS/CEIDG).
 */
export const isDeregistered = ({ context }: { context: FullOrchestrationContext }) => {
  return context.classification?.silosId === '4';
};

/**
 * Check if entity has end date (business closed)
 *
 * Used to determine if entity is still active.
 */
export const hasEndDate = ({ context }: { context: FullOrchestrationContext }) => {
  return !!context.classification?.DataZakonczeniaDzialalnosci;
};

/**
 * Check if GUS detailed data contains KRS number
 *
 * Used to decide whether to fetch additional KRS data.
 */
export const hasKrsNumber = ({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const gusData = event.output;
  if (!gusData) {
    return false;
  }
  const krsNumber =
    gusData?.praw_numerWRejestrzeEwidencji ||
    gusData?.praw_krs ||
    gusData?.krs;
  return !!krsNumber;
};

/**
 * Check if error is ENTITY_NOT_FOUND
 *
 * Used to handle 404 errors from external APIs (GUS, KRS, CEIDG).
 * These errors should NOT be retried (entity doesn't exist).
 */
export const isNotFoundError = ({ context, event }: { context: FullOrchestrationContext; event: any }) => {
  const error = event.output || event.error;

  // Check if error is BusinessException with ENTITY_NOT_FOUND errorCode
  // All services (GUS, KRS, CEIDG) throw BusinessException with standardized errorCode
  return error?.errorCode === 'ENTITY_NOT_FOUND';
};
