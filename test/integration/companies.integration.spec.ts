import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { createTestApp, closeTestApp } from '../helpers/test-app-setup';
import { TEST_NIPS, getTestApiKey } from '../fixtures/test-nips';

describe('Companies Integration Tests', () => {
  let app: INestApplication;
  const validApiKey = getTestApiKey();

  beforeAll(async () => {
    // Create test app with ValidationPipe for integration testing
    const { app: testApp } = await createTestApp({ withValidationPipe: true });
    app = testApp;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/companies', () => {
    it('should return company data for valid NIP', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: TEST_NIPS.VALID_LEGAL_ENTITY })
        .expect(200);

      // Validate required fields according to OpenAPI spec
      expect(response.body).toHaveProperty('nip', TEST_NIPS.VALID_LEGAL_ENTITY);
      expect(response.body).toHaveProperty('nazwa');
      expect(response.body).toHaveProperty('adres');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('isActive');
      expect(response.body).toHaveProperty('typPodmiotu');
      expect(response.body).toHaveProperty('zrodloDanych');
      expect(['KRS', 'CEIDG', 'GUS']).toContain(response.body.zrodloDanych);

      // Validate registrySignature field
      expect(response.body).toHaveProperty('registrySignature');
      expect(typeof response.body.registrySignature).toBe('string');
      expect(response.body.registrySignature).toMatch(/^(KRS|CEIDG|GUS) /);
      expect(response.body.registrySignature.length).toBeGreaterThan(5);

      // Validate optional fields that are present in mock
      expect(response.body).toHaveProperty('regon');
      expect(response.body).toHaveProperty('krs');
      expect(response.body).toHaveProperty('formaPrawna');

      // Validate address structure according to OpenAPI
      expect(response.body.adres).toHaveProperty('miejscowosc');
      expect(response.body.adres).toHaveProperty('kodPocztowy');
      expect(response.body.adres).toHaveProperty('ulica');
      expect(response.body.adres).toHaveProperty('numerBudynku');
      expect(response.body.adres).toHaveProperty('numerLokalu');
      expect(response.body.adres).toHaveProperty('wojewodztwo');
      expect(response.body.adres).toHaveProperty('powiat');
      expect(response.body.adres).toHaveProperty('gmina');

      // Validate data types and values
      expect(typeof response.body.isActive).toBe('boolean');
      expect(response.body.isActive).toBe(true);
      expect(response.body.status).toBe('AKTYWNY');
      expect(response.body.typPodmiotu).toMatch(/^(PRAWNA|FIZYCZNA)$/);
      expect(response.body.zrodloDanych).toMatch(/^(KRS|CEIDG|GUS)$/);
    });

    it('should return 400 for invalid NIP format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '123' })
        .expect(400);

      expect(response.body).toHaveProperty('errorCode');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('correlationId');
    });

    it('should return 400 for missing NIP', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('errorCode');
      expect(response.body).toHaveProperty('message');
    });

    it('should handle correlation ID in headers', async () => {
      const correlationId = 'test-correlation-123';

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('correlation-id', correlationId)
        .send({ nip: TEST_NIPS.VALID_LEGAL_ENTITY })
        .expect(200);

      expect(response.body).toHaveProperty('nip', TEST_NIPS.VALID_LEGAL_ENTITY);
      // Note: we can't directly verify the correlation ID in response
      // as it's used internally for logging
    });

    it('should return consistent data for same NIP across multiple calls', async () => {
      const response1 = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: TEST_NIPS.VALID_LEGAL_ENTITY })
        .expect(200);

      const response2 = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: TEST_NIPS.VALID_LEGAL_ENTITY })
        .expect(200);

      // Business data should be identical
      expect(response1.body.nip).toBe(response2.body.nip);
      expect(response1.body.nazwa).toBe(response2.body.nazwa);
      expect(response1.body.adres).toEqual(response2.body.adres);
      expect(response1.body.status).toBe(response2.body.status);
    });

    it('should handle concurrent requests', async () => {
      const testNip = TEST_NIPS.VALID_LEGAL_ENTITY;
      const requests = Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: testNip })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.nip).toBe(testNip);
        expect(response.body).toHaveProperty('nazwa');
      });

      // Verify business data consistency across concurrent calls
      const firstResponse = responses[0].body;
      responses.slice(1).forEach((response) => {
        expect(response.body.nazwa).toBe(firstResponse.nazwa);
        expect(response.body.adres).toEqual(firstResponse.adres);
      });
    });
  });

  describe('Health Check', () => {
    it('should respond to root endpoint', async () => {
      await request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Hello World!');
    });
  });
});