/**
 * Test NIPs for Integration Tests
 *
 * This file contains NIPs used across integration test suites with GUS test environment.
 * Using centralized test data management ensures consistency and makes it easy
 * to update test cases when needed.
 *
 * GUS Test Environment:
 * - Database snapshot from 8.11.2014 (outdated but complete and stable)
 * - Anonymized personal names and addresses
 * - Test API key: abcde12345abcde12345 (no registration required)
 * - All NIPs below are from this 2014 snapshot
 *
 * IMPORTANT - Data Mismatch Between GUS Test (2014) and Production KRS/CEIDG (2025):
 * - GUS test environment returns KRS numbers from 2014 (e.g., "0000028860" for PKN Orlen)
 * - These old KRS numbers NO LONGER EXIST in current production KRS API
 * - Result: Tests will show KRS 404 errors in logs → orchestration falls back to GUS-only data
 * - This is EXPECTED BEHAVIOR - tests verify that fallback mechanism works correctly
 * - Companies will have zrodloDanych: "GUS" instead of enriched KRS data
 * - Example: ORLEN returns basic GUS data without current KRS enrichment
 */

export const TEST_NIPS = {
  /**
   * PKN Orlen S.A. - Large corporation with KRS registration
   * Expected: 200 OK with GUS data (KRS 404 due to outdated 2014 KRS number)
   * Use case: Testing legal entity workflow and GUS-only fallback mechanism
   * Note: GUS returns old KRS number "0000028860" (2014) which doesn't exist in current KRS API
   */
  ORLEN: '7740001454',

  /**
   * Bakoma Sp. z o.o. - Manufacturer (dairy products)
   * Expected: 200 OK with complete data from GUS + KRS
   * Use case: Testing manufacturer entity with full PKD codes
   */
  BAKOMA: '8370000812',

  /**
   * Wielka Orkiestra Świątecznej Pomocy - Foundation
   * Expected: 200 OK with complete data from GUS + KRS
   * Use case: Testing non-profit organization workflow
   */
  WOSP: '5213003700',

  /**
   * Individual business activity (CEIDG)
   * Expected: 200 OK with data from GUS + CEIDG
   * Use case: Testing individual entrepreneur workflow
   */
  INDIVIDUAL_BUSINESS: '7122854882',

  /**
   * Valid legal entity with KRS registration (alias for ORLEN)
   * Used for backward compatibility in existing tests
   * Expected: 200 OK with complete data from GUS + KRS
   */
  VALID_LEGAL_ENTITY: '7740001454',

  /**
   * Non-existent NIP (for testing 404 error handling)
   * Expected: 404 Not Found with ENTITY_NOT_FOUND error code
   */
  NON_EXISTENT: '0000000000',

  /**
   * Invalid format - too short
   * Expected: 400 Bad Request with INVALID_NIP_FORMAT error code
   */
  INVALID_TOO_SHORT: '123',

  /**
   * Invalid format - too long
   * Expected: 400 Bad Request with INVALID_NIP_FORMAT error code
   */
  INVALID_TOO_LONG: '12345678901',

  /**
   * Invalid format - contains letters
   * Expected: 400 Bad Request with INVALID_NIP_FORMAT error code
   */
  INVALID_WITH_LETTERS: '123ABC7890',
} as const;

/**
 * Helper to get valid API key for tests
 * Returns the default API key from environment.schema.ts
 */
export const getTestApiKey = () =>
  'dev_api_key_1234567890abcdef1234567890abcdef';