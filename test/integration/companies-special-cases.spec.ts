import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { createTestApp, closeTestApp } from '../helpers/test-app-setup';
import { SPECIAL_TEST_NIPS, SPECIAL_TEST_SCENARIOS } from '../fixtures/special-test-nips';
import { getTestApiKey } from '../fixtures/test-nips';

/**
 * Integration Tests - Special Business Cases
 *
 * This test suite covers complex edge cases and special scenarios:
 * - CEIDG sole traders
 * - KRS P and S registries with fallback
 * - Deregistered companies
 * - Companies in bankruptcy
 * - Companies in liquidation
 *
 * All tests use real NIPs from Polish government databases.
 * Status detection based on dokumentacja.md section 3.
 */
describe('Integration Tests - Special Business Cases', () => {
  let app: INestApplication;
  const validApiKey = getTestApiKey();

  beforeAll(async () => {
    // Create test app using helper
    const { app: testApp } = await createTestApp();
    app = testApp;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('CEIDG - Sole Traders', () => {
    it(
      'should handle CEIDG entrepreneur (7122854882)',
      async () => {
        const scenario = SPECIAL_TEST_SCENARIOS.CEIDG_ENTREPRENEUR;

        const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: scenario.nip })
        .expect(scenario.expectedStatus);

      // Verify entity type
      expect(response.body.typPodmiotu).toBe(scenario.expectedData.typPodmiotu);

      // Verify data source
      expect(response.body.zrodloDanych).toBe(scenario.expectedData.zrodloDanych);

      // Verify status
      expect(response.body.status).toBe(scenario.expectedData.status);
      expect(response.body.isActive).toBe(scenario.expectedData.isActive);

      // Verify required fields for CEIDG
      expect(response.body).toHaveProperty('nazwa');
      expect(response.body).toHaveProperty('nip', scenario.nip);
      expect(response.body).toHaveProperty('adres');
      expect(response.body.adres).toHaveProperty('miejscowosc');
      expect(response.body.adres).toHaveProperty('kodPocztowy');
      },
      10000,
    ); // 10s timeout for external CEIDG API
  });

  describe('KRS - Register P (Entrepreneurs)', () => {
    it(
      'should handle KRS P company (7123426183)',
      async () => {
        const scenario = SPECIAL_TEST_SCENARIOS.KRS_P_COMPANY;

        const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: scenario.nip })
        .expect(scenario.expectedStatus);

      // Verify entity type
      expect(response.body.typPodmiotu).toBe(scenario.expectedData.typPodmiotu);

      // Verify data source
      expect(response.body.zrodloDanych).toBe(scenario.expectedData.zrodloDanych);

      // Verify KRS number (must be 10 digits for legal entities)
      expect(response.body.krs).toMatch(/^\d{10}$/);

      // Verify status
      expect(response.body.status).toBe(scenario.expectedData.status);
      expect(response.body.isActive).toBe(scenario.expectedData.isActive);
      },
      10000,
    ); // 10s timeout for external GUS + KRS API

    it(
      'should handle company in bankruptcy P (7650006749)',
      async () => {
        const scenario = SPECIAL_TEST_SCENARIOS.KRS_P_BANKRUPTCY;

        const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: scenario.nip })
        .expect(scenario.expectedStatus);

      // Verify bankruptcy status from dzial6.postepowanieUpadlosciowe
      expect(response.body.status).toBe(scenario.expectedData.status);
      expect(response.body.isActive).toBe(scenario.expectedData.isActive);

      // Verify entity type and source
      expect(response.body.typPodmiotu).toBe(scenario.expectedData.typPodmiotu);
      expect(response.body.zrodloDanych).toBe(scenario.expectedData.zrodloDanych);

      // Verify KRS number exists
      expect(response.body.krs).toMatch(/^\d{10}$/);
      },
      10000,
    ); // 10s timeout for external API

    it(
      'should handle transformed company (5213137406)',
      async () => {
        const scenario = SPECIAL_TEST_SCENARIOS.KRS_P_TRANSFORMED;

        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: scenario.nip })
          .expect(scenario.expectedStatus);

        // Verify entity type and source
        expect(response.body.typPodmiotu).toBe(scenario.expectedData.typPodmiotu);
        expect(response.body.zrodloDanych).toBe(scenario.expectedData.zrodloDanych);

        // Verify status - transformed company is AKTYWNY with new KRS
        expect(response.body.status).toBe(scenario.expectedData.status);
        expect(response.body.isActive).toBe(scenario.expectedData.isActive);

        // Verify KRS number exists (should be new KRS after transformation)
        expect(response.body.krs).toMatch(/^\d{10}$/);

        // GUS should return the current active KRS (0001168946), not old one (0000017748)
        expect(response.body.krs).toBe('0001168946');
      },
      10000,
    ); // 10s timeout for external API
  });

  describe('KRS - Register S (Associations/Foundations)', () => {
    it(
      'should handle KRS S foundation with P→S fallback (5213003700)',
      async () => {
        const scenario = SPECIAL_TEST_SCENARIOS.KRS_S_FOUNDATION;

        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: scenario.nip })
          .expect(scenario.expectedStatus);

        // Verify entity type
        expect(response.body.typPodmiotu).toBe(scenario.expectedData.typPodmiotu);

        // Verify data source (should be KRS after P→S fallback)
        expect(response.body.zrodloDanych).toBe(scenario.expectedData.zrodloDanych);

        // Verify KRS number
        expect(response.body.krs).toMatch(/^\d{10}$/);

        // Verify status
        expect(response.body.status).toBe(scenario.expectedData.status);
        expect(response.body.isActive).toBe(scenario.expectedData.isActive);
      },
      10000,
    ); // 10s timeout for external API

    it(
      'should handle foundation in bankruptcy S (5992894605)',
      async () => {
        const scenario = SPECIAL_TEST_SCENARIOS.KRS_S_BANKRUPTCY;

        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: scenario.nip })
          .expect(scenario.expectedStatus);

        // Verify bankruptcy status from dzial6.postepowanieUpadlosciowe
        expect(response.body.status).toBe(scenario.expectedData.status);
        expect(response.body.isActive).toBe(scenario.expectedData.isActive);

        // Verify entity type and source
        expect(response.body.typPodmiotu).toBe(scenario.expectedData.typPodmiotu);
        expect(response.body.zrodloDanych).toBe(scenario.expectedData.zrodloDanych);

        // Verify KRS number exists
        expect(response.body.krs).toMatch(/^\d{10}$/);
      },
      10000,
    ); // 10s timeout for external API
  });

  describe('Data Quality and Consistency', () => {
    it('should return consistent structure for all special cases', async () => {
      const responses = [];

      // Test multiple cases
      const testNips = [
        SPECIAL_TEST_NIPS.CEIDG_ENTREPRENEUR,
        SPECIAL_TEST_NIPS.KRS_P_COMPANY,
        SPECIAL_TEST_NIPS.KRS_P_TRANSFORMED,
      ];

      for (const nip of testNips) {
        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip })
          .expect(200);

        responses.push(response.body);
      }

      // All responses should have consistent required fields
      responses.forEach((body) => {
        expect(body).toHaveProperty('nip');
        expect(body).toHaveProperty('nazwa');
        expect(body).toHaveProperty('adres');
        expect(body).toHaveProperty('status');
        expect(body).toHaveProperty('isActive');
        expect(body).toHaveProperty('typPodmiotu');
        expect(body).toHaveProperty('zrodloDanych');
        expect(body).toHaveProperty('dataAktualizacji');

        // Status and isActive must be consistent
        if (body.status === 'AKTYWNY') {
          expect(body.isActive).toBe(true);
        } else {
          expect(body.isActive).toBe(false);
        }
      });
    }, 15000); // Increased timeout for multiple external API calls

    it(
      'should properly differentiate between bankruptcy and liquidation',
      async () => {
        // Test bankruptcy case
        const bankruptcyResponse = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: SPECIAL_TEST_NIPS.KRS_P_BANKRUPTCY })
          .expect(200);

        expect(bankruptcyResponse.body.status).toBe('UPADŁOŚĆ');
        expect(bankruptcyResponse.body.isActive).toBe(false);

        // Test liquidation case
        const liquidationResponse = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: SPECIAL_TEST_NIPS.KRS_LIQUIDATION })
          .expect(200);

        expect(liquidationResponse.body.status).toBe('W LIKWIDACJI');
        expect(liquidationResponse.body.isActive).toBe(false);
      },
      10000,
    ); // 10s timeout for external API
  });
});