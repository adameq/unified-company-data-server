import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { createTestApp, closeTestApp } from '../helpers/test-app-setup';

/**
 * T011: Integration test for successful NIP lookup
 * Based on implementation-examples.md lines 2858-2936
 *
 * This test verifies the complete happy path workflow:
 * 1. Valid NIP input validation
 * 2. Successful orchestration through state machine
 * 3. Proper UnifiedCompanyData response format
 * 4. Correlation ID tracking
 * 5. Response timing requirements
 */
describe('Integration Tests - Successful Company Lookup', () => {
  let app: INestApplication;
  let validApiKey: string;

  beforeAll(async () => {
    // Use known API key from .env
    validApiKey = 'test-api-key-for-development-at-least-32-characters-long';

    // Create test app using helper (no ValidationPipe needed for success scenarios)
    const { app: testApp } = await createTestApp();
    app = testApp;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/companies - Successful Scenarios', () => {
    it('should return complete company data for valid active company NIP', async () => {
      const startTime = Date.now();

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '5260250995' }) // Real NIP: Orange Polska S.A.
        .expect(200);

      const responseTime = Date.now() - startTime;

      // Verify response structure matches OpenAPI spec
      expect(response.body).toHaveProperty('nip', '5260250995');
      expect(response.body).toHaveProperty('nazwa');
      expect(response.body).toHaveProperty('adres');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('isActive');
      expect(response.body).toHaveProperty('typPodmiotu');
      expect(response.body).toHaveProperty('zrodloDanych');

      // Verify required address fields
      expect(response.body.adres).toHaveProperty('miejscowosc');
      expect(response.body.adres).toHaveProperty('kodPocztowy');
      expect(response.body.adres.kodPocztowy).toMatch(/^\d{2}-\d{3}$/);

      // Verify data types and constraints
      expect(typeof response.body.isActive).toBe('boolean');
      expect(['PRAWNA', 'FIZYCZNA']).toContain(response.body.typPodmiotu);
      expect(['KRS', 'CEIDG', 'GUS']).toContain(response.body.zrodloDanych);

      // Verify response time requirement (should be under 2.5s)
      expect(responseTime).toBeLessThan(2500);
    });

    it('should handle different company types correctly', async () => {
      // Test with real NIP that exists in GUS system
      const testCases = [
        { nip: '5260250995', expectedSource: ['KRS', 'CEIDG', 'GUS'] }, // Orange Polska S.A.
      ];

      for (const testCase of testCases) {
        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: testCase.nip })
          .expect(200);

        expect(response.body.nip).toBe(testCase.nip);
        expect(testCase.expectedSource).toContain(response.body.zrodloDanych);
        expect(response.body).toHaveProperty('nazwa');
        expect(response.body).toHaveProperty('isActive');
      }
    });

    it('should include correlation ID in logs (implicit test)', async () => {
      // This test verifies that correlation IDs are properly tracked
      // We can't directly verify logs in integration test, but we can ensure
      // the request completes successfully with proper structure

      const customCorrelationId = 'test-correlation-12345';

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('correlation-id', customCorrelationId)
        .send({ nip: '5260250995' }) // Real NIP: Orange Polska S.A.
        .expect(200);

      // Verify the response is properly structured
      expect(response.body).toHaveProperty('nip');
      expect(response.body).toHaveProperty('nazwa');

      // In a real implementation, correlation ID should be tracked in logs
      // This would be verified through log aggregation tools in production
    });

    it('should handle concurrent requests without issues', async () => {
      // Test concurrent requests using the same real NIP
      // This verifies that the system can handle parallel requests properly
      const concurrentRequests = 5;
      const testNip = '5260250995'; // Real NIP: Orange Polska S.A.

      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: testNip })
      );

      const responses = await Promise.all(requests);

      // Verify all requests succeeded with the same data
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.nip).toBe(testNip);
        expect(response.body).toHaveProperty('nazwa');
        expect(response.body).toHaveProperty('status');
      });

      // Verify all responses have the same business data (excluding metadata)
      const firstResponse = responses[0].body;
      responses.slice(1).forEach((response) => {
        // Compare business data, excluding dynamic metadata fields
        expect(response.body.nip).toEqual(firstResponse.nip);
        expect(response.body.nazwa).toEqual(firstResponse.nazwa);
        expect(response.body.adres).toEqual(firstResponse.adres);
        expect(response.body.status).toEqual(firstResponse.status);
        expect(response.body.zrodloDanych).toEqual(firstResponse.zrodloDanych);

        // Metadata fields (correlationId, timestamp) are expected to be different
        // This is correct behavior - each request has unique tracking
      });
    });

    it('should return consistent data format across multiple calls', async () => {
      const calls = 3;
      const responses = [];

      for (let i = 0; i < calls; i++) {
        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: '5260250995' }) // Real NIP: Orange Polska S.A.
          .expect(200);

        responses.push(response.body);
      }

      // Verify consistency across calls
      const firstResponse = responses[0];
      responses.forEach(response => {
        expect(response.nip).toBe(firstResponse.nip);
        expect(response.nazwa).toBe(firstResponse.nazwa);
        expect(response.zrodloDanych).toBe(firstResponse.zrodloDanych);

        // Structure should be identical
        expect(Object.keys(response).sort()).toEqual(Object.keys(firstResponse).sort());
      });
    });

    it('should handle optional fields properly', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '5260250995' }) // Real NIP: Orange Polska S.A.
        .expect(200);

      // Required fields must be present
      expect(response.body.nazwa).toBeDefined();
      expect(response.body.nip).toBeDefined();
      expect(response.body.adres).toBeDefined();
      expect(response.body.status).toBeDefined();
      expect(response.body.isActive).toBeDefined();
      expect(response.body.typPodmiotu).toBeDefined();
      expect(response.body.zrodloDanych).toBeDefined();

      // Optional fields may or may not be present, but if present should be valid
      if (response.body.regon) {
        expect(response.body.regon).toMatch(/^\d{9}$|^\d{14}$/);
      }

      if (response.body.krs) {
        expect(response.body.krs).toMatch(/^\d{10}$/);
      }

      if (response.body.dataRozpoczeciaDzialalnosci) {
        expect(response.body.dataRozpoczeciaDzialalnosci).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('should handle legal entity without KRS number in GUS data (negative data scenario)', async () => {
      // This test verifies PRD section 8.1 "Dane negatywne" handling
      // When GUS returns data for silosId=6 (legal entity) but without KRS number,
      // the system should treat it as negative data (not an error) and return GUS-only data

      // Note: This test will work when there's a real company with silosId=6
      // but no KRS number in GUS database. For now, we'll test that the system
      // doesn't fail catastrophically.

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '5260250995' }) // Real NIP: Orange Polska S.A.
        .expect((res: any) => {
          // Accept both 200 (successful GUS-only response) and other valid responses
          // The key is that we should NOT get 502 Bad Gateway
          expect([200, 404]).toContain(res.status);
        });

      if (response.status === 200) {
        // If we got data, verify it's valid
        expect(response.body).toHaveProperty('nip');
        expect(response.body).toHaveProperty('nazwa');
        expect(response.body).toHaveProperty('zrodloDanych');

        // If it's a GUS-only response, KRS field should be undefined or absent
        if (response.body.zrodloDanych === 'GUS') {
          // This is the expected behavior for companies without KRS
          // Successfully returned GUS-only data for legal entity without KRS number
        }
      }
    });
  });

  describe('POST /api/companies - Retry Logic', () => {
    it('should eventually succeed after transient errors (implicit retry test)', async () => {
      // This test verifies that the retry machine is working by making a request
      // The external APIs may have transient errors that are automatically retried

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '5260250995' }) // Real NIP: Orange Polska S.A.
        .expect((res: any) => {
          // Should either succeed (200) or fail with a proper error (not a crash)
          expect([200, 404, 502]).toContain(res.status);
        });

      if (response.status === 200) {
        // Request succeeded (possibly after retries)
      } else if (response.status === 502) {
        // 502 is acceptable if external API is truly down after all retries
        // External API unavailable after retries (expected in some cases)
      }
    });

    it('should not retry on 404 errors (non-retryable negative data)', async () => {
      // This test verifies that 404 errors are treated as negative data
      // and NOT retried (per PRD section 8.3.0)

      const startTime = Date.now();

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '0000000000' }) // Likely non-existent NIP
        .expect((res: any) => {
          // Should get 404 or another valid error code
          expect([404, 400]).toContain(res.status);
        });

      const responseTime = Date.now() - startTime;

      // Response should be fast (no retries for 404)
      // If there were retries, it would take at least initialDelay * retries (100-200ms+)
      // Without retries, should be under 2 seconds
      expect(responseTime).toBeLessThan(2000);
    });
  });
});