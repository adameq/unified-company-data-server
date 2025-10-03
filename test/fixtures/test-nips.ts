/**
 * Test NIPs for Integration Tests
 *
 * This file contains real and test NIPs used across integration test suites.
 * Using centralized test data management ensures consistency and makes it easy
 * to update test cases when needed.
 */

export const TEST_NIPS = {
  /**
   * Valid legal entity with KRS registration
   * Company: Orange Polska S.A.
   * Expected: 200 OK with complete data from GUS + KRS
   */
  VALID_LEGAL_ENTITY: '5260250995',

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
 * Test scenarios with descriptions
 */
export const TEST_SCENARIOS = {
  SUCCESS: {
    nip: TEST_NIPS.VALID_LEGAL_ENTITY,
    expectedStatus: 200,
    description: 'Valid active company with complete data',
  },
  NOT_FOUND: {
    nip: TEST_NIPS.NON_EXISTENT,
    expectedStatus: 404,
    description: 'Non-existent company',
  },
  INVALID_FORMAT_SHORT: {
    nip: TEST_NIPS.INVALID_TOO_SHORT,
    expectedStatus: 400,
    description: 'NIP too short',
  },
  INVALID_FORMAT_LONG: {
    nip: TEST_NIPS.INVALID_TOO_LONG,
    expectedStatus: 400,
    description: 'NIP too long',
  },
  INVALID_FORMAT_LETTERS: {
    nip: TEST_NIPS.INVALID_WITH_LETTERS,
    expectedStatus: 400,
    description: 'NIP contains non-numeric characters',
  },
} as const;

/**
 * Helper to get valid API key for tests
 * Returns the default API key from environment.schema.ts
 */
export const getTestApiKey = () =>
  'dev_api_key_1234567890abcdef1234567890abcdef';