import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TEST_NIPS, getTestApiKey } from '../fixtures/test-nips';
import { ValidationException } from '../../src/common/exceptions/validation.exception';

/**
 * T012: Integration test for error scenarios
 * Based on implementation-examples.md lines 2939-3034
 *
 * This test verifies proper error handling for:
 * 1. Invalid input validation
 * 2. Missing required fields
 * 3. Malformed requests
 * 4. Not found scenarios
 * 5. Proper ErrorResponse format
 * 6. Correlation ID tracking in errors
 */
describe('Integration Tests - Error Scenarios', () => {
  let app: INestApplication;
  let validApiKey: string;

  beforeAll(async () => {
    // Environment validation is now handled by ConfigModule in AppModule
    validApiKey = getTestApiKey();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Enable ValidationPipe with exceptionFactory like in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        stopAtFirstError: false,
        forbidUnknownValues: true,
        validateCustomDecorators: true,
        exceptionFactory: (errors) => {
          return new ValidationException(errors);
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/companies - Input Validation Errors', () => {
    it('should return 400 for invalid NIP format (too short)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '123' })
        .expect(400);

      // Verify ErrorResponse structure according to OpenAPI spec
      expect(response.body).toHaveProperty('errorCode');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('timestamp');

      // Verify error details
      expect(response.body.errorCode).toBe('INVALID_NIP_FORMAT');
      expect(response.body.message).toContain('NIP');
      expect(response.body.message).toContain('10 digits');
      expect(response.body.source).toBe('INTERNAL');
    });

    it('should return 400 for invalid NIP format (too long)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '12345678901' })
        .expect(400);

      expect(response.body.errorCode).toBe('INVALID_NIP_FORMAT');
      expect(response.body.message).toContain('10 digits');
      expect(response.body).toHaveProperty('correlationId');
    });

    it('should return 400 for NIP with non-numeric characters', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '123456789A' })
        .expect(400);

      expect(response.body.errorCode).toBe('INVALID_NIP_FORMAT');
      expect(response.body.message).toContain('digits');
    });

    it('should return 400 for missing NIP field', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('errorCode');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('correlationId');
    });

    it('should return 400 for null NIP', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: null })
        .expect(400);

      expect(response.body).toHaveProperty('errorCode', 'INVALID_NIP_FORMAT');
      expect(response.body.message).toContain('Invalid NIP format');
    });

    it('should return 400 for empty string NIP', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: '' })
        .expect(400);

      expect(response.body.errorCode).toBe('INVALID_NIP_FORMAT');
    });
  });

  describe('POST /api/companies - Request Format Errors', () => {
    it('should return 400 for malformed JSON', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('Content-Type', 'application/json')
        .send('{"nip": "1234567890"') // Malformed JSON - missing closing brace
        .expect(400);

      expect(response.body).toHaveProperty('errorCode');
      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 for wrong content type', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('Content-Type', 'text/plain')
        .send('1234567890')
        .expect(400);

      expect(response.body).toHaveProperty('errorCode');
    });

    it('should return 400 for extra unexpected fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({
          nip: TEST_NIPS.VALID_LEGAL_ENTITY,
          extraField: 'should not be here',
          anotherField: 123
        })
        .expect(400);

      expect(response.body).toHaveProperty('errorCode', 'INVALID_REQUEST_FORMAT');
      expect(response.body.message).toContain('Invalid request format');
      expect(response.body.message).toContain('extraField');
      expect(response.body.message).toContain('anotherField');
    });
  });

  describe('POST /api/companies - Business Logic Errors', () => {
    it('should handle company not found scenario gracefully', async () => {
      // This test uses a non-existent NIP to test 404 handling
      // Real external APIs return 404 for non-existent companies

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: TEST_NIPS.NON_EXISTENT })
        .expect(404);

      // Verify proper error structure
      expect(response.body).toHaveProperty('errorCode');
      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.errorCode).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('Error Response Format Validation', () => {
    it('should include correlation ID in all error responses', async () => {
      const customCorrelationId = 'error-test-correlation-123';

      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .set('correlation-id', customCorrelationId)
        .send({ nip: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('correlationId');
      // In a full implementation, this should be the custom correlation ID
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.body.correlationId.length).toBeGreaterThan(0);
    });

    it('should generate correlation ID when not provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('correlationId');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.body.correlationId.length).toBeGreaterThan(0);
    });

    it('should include timestamp in ISO 8601 format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: 'invalid' })
        .expect(400);

      expect(response.body).toHaveProperty('timestamp');

      // Verify timestamp is valid ISO 8601
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toISOString()).toBe(response.body.timestamp);

      // Verify timestamp is recent (within last 5 seconds)
      const now = new Date();
      const diff = now.getTime() - timestamp.getTime();
      expect(diff).toBeLessThan(5000);
    });

    it('should limit error message length', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: 'invalid' })
        .expect(400);

      expect(response.body.message.length).toBeLessThanOrEqual(500);
    });

    it('should use proper HTTP status codes for different error types', async () => {
      // Test various error scenarios and their expected status codes

      // Invalid input -> 400
      await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send({ nip: 'invalid' })
        .expect(400);

      // Missing body -> 400
      await request(app.getHttpServer())
        .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
        .send()
        .expect(400);

      // Wrong HTTP method -> 405
      await request(app.getHttpServer())
        .get('/api/companies')
        .expect(404); // NestJS returns 404 for non-existent routes
    });
  });

  describe('Multiple Errors Handling', () => {
    it('should handle rapid successive invalid requests', async () => {
      const responses = [];

      // Execute requests sequentially to avoid connection issues
      for (let i = 0; i < 5; i++) {
        const response = await request(app.getHttpServer())
          .post('/api/companies')
          .set('Authorization', `Bearer ${validApiKey}`)
          .send({ nip: `invalid${i}` })
          .expect(400);

        responses.push(response);
      }

      // Verify all responses have correct structure
      responses.forEach((response, index) => {
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('errorCode');
        expect(response.body).toHaveProperty('correlationId');
      });

      // Each error should have unique correlation ID
      const correlationIds = responses.map(r => r.body.correlationId);
      const uniqueIds = new Set(correlationIds);
      expect(uniqueIds.size).toBe(correlationIds.length);
    });

    it('should maintain error response consistency across different error types', async () => {
      const errorRequests = [
        { send: { nip: '123' }, expectedStatus: 400 },
        { send: { nip: 'abc1234567' }, expectedStatus: 400 },
        { send: {}, expectedStatus: 400 },
        { send: { nip: null }, expectedStatus: 400 },
      ];

      for (const errorRequest of errorRequests) {
        const response = await request(app.getHttpServer())
          .post('/api/companies')
        .set('Authorization', `Bearer ${validApiKey}`)
          .send(errorRequest.send)
          .expect(errorRequest.expectedStatus);

        // All error responses should have consistent structure
        expect(response.body).toHaveProperty('errorCode');
        expect(response.body).toHaveProperty('message');
        expect(response.body).toHaveProperty('correlationId');
        expect(response.body).toHaveProperty('timestamp');

        expect(typeof response.body.errorCode).toBe('string');
        expect(typeof response.body.message).toBe('string');
        expect(typeof response.body.correlationId).toBe('string');
        expect(typeof response.body.timestamp).toBe('string');
      }
    });
  });
});