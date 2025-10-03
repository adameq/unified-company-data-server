/**
 * Special Test NIPs for Complex Business Cases
 *
 * This file contains real NIPs for testing various edge cases and special scenarios:
 * - CEIDG entrepreneurs (sole traders)
 * - KRS entities in different registries (P and S)
 * - Deregistered companies
 * - Companies in bankruptcy
 * - Companies in liquidation
 *
 * These NIPs are used in companies-special-cases.spec.ts integration tests.
 */

export const SPECIAL_TEST_NIPS = {
  /**
   * CEIDG Entrepreneur - Sole Trader
   * NIP: 7122854882
   * Expected: typPodmiotu='FIZYCZNA', zrodloDanych='CEIDG', status='AKTYWNY'
   */
  CEIDG_ENTREPRENEUR: '7122854882',

  /**
   * KRS Register P - Limited Liability Company (Spółka z o.o.)
   * NIP: 7123426183
   * Expected: typPodmiotu='PRAWNA', zrodloDanych='KRS', status='AKTYWNY'
   */
  KRS_P_COMPANY: '7123426183',

  /**
   * KRS Register S - Foundation (Fundacja)
   * NIP: 5213003700
   * Expected: typPodmiotu='PRAWNA', zrodloDanych='KRS'
   * Note: Requires P→S fallback strategy
   */
  KRS_S_FOUNDATION: '5213003700',

  /**
   * KRS Register P - Transformed Company (Spółka przekształcona)
   * NIP: 5213137406
   * Expected: typPodmiotu='PRAWNA', status='AKTYWNY', isActive=true
   * Note: Company was transformed (old KRS: 0000017748 → new KRS: 0001168946)
   * GUS correctly returns the current active KRS number
   */
  KRS_P_TRANSFORMED: '5213137406',

  /**
   * KRS Register P - Company in Bankruptcy (Spółka w upadłości)
   * NIP: 7650006749
   * Expected: typPodmiotu='PRAWNA', status='UPADŁOŚĆ', isActive=false
   * Note: dzial6.postepowanieUpadlosciowe should be present
   */
  KRS_P_BANKRUPTCY: '7650006749',

  /**
   * KRS Register S - Foundation in Bankruptcy (Fundacja w upadłości)
   * NIP: 5992894605
   * Expected: typPodmiotu='PRAWNA', status='UPADŁOŚĆ', isActive=false
   * Note: Requires P→S fallback + dzial6.postepowanieUpadlosciowe
   */
  KRS_S_BANKRUPTCY: '5992894605',

  /**
   * Company in Liquidation (Spółka w likwidacji)
   * NIP: 6831972447
   * Expected: typPodmiotu='PRAWNA', status='LIKWIDACJA', isActive=false
   * Note: formaLikwidacji field should indicate liquidation
   */
  KRS_LIQUIDATION: '6831972447',
} as const;

/**
 * Test scenarios with expected results
 */
export const SPECIAL_TEST_SCENARIOS = {
  CEIDG_ENTREPRENEUR: {
    nip: SPECIAL_TEST_NIPS.CEIDG_ENTREPRENEUR,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'FIZYCZNA',
      zrodloDanych: 'CEIDG',
      status: 'AKTYWNY',
      isActive: true,
    },
    description: 'CEIDG sole trader - active business',
  },
  KRS_P_COMPANY: {
    nip: SPECIAL_TEST_NIPS.KRS_P_COMPANY,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'PRAWNA',
      zrodloDanych: 'KRS',
      status: 'AKTYWNY',
      isActive: true,
    },
    description: 'KRS P registry - active company',
  },
  KRS_S_FOUNDATION: {
    nip: SPECIAL_TEST_NIPS.KRS_S_FOUNDATION,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'PRAWNA',
      zrodloDanych: 'KRS',
      status: 'AKTYWNY',
      isActive: true,
    },
    description: 'KRS S registry - foundation with P→S fallback',
  },
  KRS_P_TRANSFORMED: {
    nip: SPECIAL_TEST_NIPS.KRS_P_TRANSFORMED,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'PRAWNA',
      zrodloDanych: 'KRS',
      status: 'AKTYWNY',
      isActive: true,
    },
    description: 'Transformed company - GUS returns current active KRS',
  },
  KRS_P_BANKRUPTCY: {
    nip: SPECIAL_TEST_NIPS.KRS_P_BANKRUPTCY,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'PRAWNA',
      zrodloDanych: 'KRS',
      status: 'UPADŁOŚĆ',
      isActive: false,
    },
    description: 'Company in bankruptcy - P registry',
  },
  KRS_S_BANKRUPTCY: {
    nip: SPECIAL_TEST_NIPS.KRS_S_BANKRUPTCY,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'PRAWNA',
      zrodloDanych: 'KRS',
      status: 'UPADŁOŚĆ',
      isActive: false,
    },
    description: 'Foundation in bankruptcy - S registry with fallback',
  },
  KRS_LIQUIDATION: {
    nip: SPECIAL_TEST_NIPS.KRS_LIQUIDATION,
    expectedStatus: 200,
    expectedData: {
      typPodmiotu: 'PRAWNA',
      zrodloDanych: 'KRS',
      status: 'W LIKWIDACJI',
      isActive: false,
    },
    description: 'Company in liquidation',
  },
} as const;