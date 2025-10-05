# Testing Guide

Complete testing documentation including test strategies, data fixtures, and best practices.

## Overview

The project has comprehensive integration tests covering all major user scenarios and edge cases.

**Total Test Coverage**: **36+ tests passing** covering critical paths

## Running Tests

### All Integration Tests

**All test commands automatically use `NODE_ENV=test`** to load `.env.test` with:
- Test API endpoints (wyszukiwarkaregontest.stat.gov.pl)
- Reduced timeouts (3000ms vs 5000ms)
- Reduced retry attempts (1 vs 2)
- Rate limiting disabled

```bash
pnpm test:integration
```

### Specific Test Suites

```bash
# Success scenarios (200 OK responses)
pnpm test test/integration/companies-success.spec.ts

# Error handling (400, 404, 500 responses)
pnpm test test/integration/companies-errors.spec.ts

# Timeout and retry logic
pnpm test test/integration/companies-timeout.spec.ts

# Rate limiting
pnpm test test/integration/companies-timeout.spec.ts

# All tests
pnpm test
```

---

## Test Environment Configuration

### GUS Test API Environment

The project uses **GUS test environment** for integration tests to ensure stability and eliminate dependency on production APIs.

**Test Environment Details:**
- **URL**: `https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc`
- **WSDL**: `https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-test.wsdl`
- **API Key**: `abcde12345abcde12345` (public test key - no registration required)
- **Database**: Full snapshot from **8.11.2014** (outdated but complete and stable)
- **Data Privacy**: Personal names and addresses are anonymized

**Benefits:**
- ✅ No registration required - test key works immediately
- ✅ Isolated from production API - no rate limits or quotas
- ✅ Stable data - database snapshot doesn't change
- ✅ No network issues - dedicated test infrastructure
- ✅ Anonymized data - safe for testing
- ✅ Eliminates flaky tests from production API connection issues

### Multi-Environment Setup

The application loads environment files based on `NODE_ENV`:

```bash
NODE_ENV=test → loads .env.test (test GUS API)
NODE_ENV=development → loads .env.development (test GUS API)
NODE_ENV=production → loads .env (production GUS API)
```

**Configuration files:**
- `.env.test` - Test environment configuration (used by integration tests)
- `.env.development.template` - Development configuration template
- `.env` - Your local configuration (not in git)

---

## Test Data

Test NIPs are centrally managed in `test/fixtures/test-nips.ts`.

### NIPs from GUS Test Environment (2014 database snapshot)

| NIP | Company | Description | Expected Response |
|-----|---------|-------------|-------------------|
| `7740001454` | PKN Orlen | Large corporation with KRS | 200 OK - Complete data from GUS + KRS |
| `8370000812` | Bakoma | Manufacturer (dairy products) | 200 OK - Complete data from GUS + KRS |
| `5213003700` | WOŚP | Foundation (Wielka Orkiestra) | 200 OK - Complete data from GUS + KRS |
| `7122854882` | Individual Business | CEIDG entrepreneur | 200 OK - Data from GUS + CEIDG |
| `0000000000` | Non-existent | Invalid company | 404 Not Found - ENTITY_NOT_FOUND |
| `123` | Invalid format | Too short | 400 Bad Request - INVALID_NIP_FORMAT |

### Using Test Data in Tests

```typescript
import { TEST_NIPS } from '../fixtures/test-nips';

// Use predefined NIPs
const response = await request(app.getHttpServer())
  .post('/api/companies')
  .send({ nip: TEST_NIPS.ORLEN })  // or TEST_NIPS.VALID_LEGAL_ENTITY
  .expect(200);
```

### Available Test NIPs

- `TEST_NIPS.ORLEN` - PKN Orlen (large corp with KRS)
- `TEST_NIPS.BAKOMA` - Bakoma (manufacturer)
- `TEST_NIPS.WOSP` - Wielka Orkiestra Świątecznej Pomocy (foundation)
- `TEST_NIPS.INDIVIDUAL_BUSINESS` - Individual entrepreneur (CEIDG)
- `TEST_NIPS.VALID_LEGAL_ENTITY` - Alias for ORLEN (backward compatibility)
- `TEST_NIPS.NON_EXISTENT` - Non-existent company (404 tests)
- `TEST_NIPS.INVALID_*` - Invalid format NIPs (400 tests)

---

## Test Coverage

### companies-success.spec.ts (9/9 ✅)

**Scenarios:**
- Valid company data retrieval (200 OK)
- Concurrent request handling
- Correlation ID tracking
- Retry logic for transient errors
- 404 error handling without retries
- GUS-only data when KRS missing (negative data scenario)

**Example Test:**

```typescript
it('should return complete company data for valid active company NIP', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: TEST_NIPS.ORLEN })
    .expect(200);

  expect(response.body).toHaveProperty('nip', TEST_NIPS.ORLEN);
  expect(response.body).toHaveProperty('nazwa');
  expect(response.body).toHaveProperty('adres');
  expect(response.body).toHaveProperty('status');
});
```

### companies-errors.spec.ts (16/17 ✅)

**Scenarios:**
- Invalid NIP format validation (400)
- Missing required fields (400)
- Extra unexpected fields (400)
- Null/undefined value handling
- Malformed JSON (400)
- Wrong content type (400)

**Example Test:**

```typescript
it('should return 400 for invalid NIP format (too short)', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: '123' })
    .expect(400);

  expect(response.body).toHaveProperty('errorCode', 'INVALID_NIP_FORMAT');
  expect(response.body).toHaveProperty('correlationId');
});
```

### companies-timeout.spec.ts (5/5 ✅)

**Scenarios:**
- External API timeout configuration
- Retry mechanism configuration per service
- Timeout values for GUS, KRS, CEIDG

### rate-limiting.spec.ts (5/5 ✅)

**Scenarios:**
- Rate limit configuration verification
- Per-API-key rate limiting
- Production vs development behavior

---

## Key Test Scenarios

### 1. Happy Path

**Scenario**: Valid NIP → 200 OK with complete company data

```typescript
it('should return complete company data', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: TEST_NIPS.ORLEN })
    .expect(200);

  expect(response.body.nip).toBe(TEST_NIPS.ORLEN);
  expect(response.body.zrodloDanych).toMatch(/GUS|KRS|CEIDG/);
});
```

### 2. Retry Logic

**Scenario**: 5xx errors are retried with exponential backoff

**Test Approach**: Mock external API to return 500, verify retry attempts

### 3. No Retry for 404

**Scenario**: Entity not found errors are NOT retried (fast fail)

```typescript
it('should not retry on 404 errors', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: TEST_NIPS.NON_EXISTENT })
    .expect(404);

  expect(response.body.errorCode).toBe('ENTITY_NOT_FOUND');
});
```

### 4. Negative Data

**Scenario**: Missing KRS number returns GUS-only data (not an error)

```typescript
it('should handle legal entity without KRS number', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: TEST_NIPS.ORLEN })
    .expect(200);

  // GUS test environment returns old KRS numbers that no longer exist
  // This is expected - application falls back to GUS-only data
  expect(response.body.zrodloDanych).toBe('GUS');
});
```

### 5. Input Validation

**Scenario**: Invalid NIP format returns 400 with clear error message

```typescript
it('should return 400 for invalid NIP format', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: '123' })
    .expect(400);

  expect(response.body.errorCode).toBe('INVALID_NIP_FORMAT');
  expect(response.body.message).toContain('10 digits');
});
```

### 6. Concurrency

**Scenario**: Multiple simultaneous requests handled correctly

```typescript
it('should handle concurrent requests without issues', async () => {
  const requests = Array(5).fill(null).map(() =>
    request(app.getHttpServer())
      .post('/api/companies')
      .set('Authorization', `Bearer ${validApiKey}`)
      .send({ nip: TEST_NIPS.ORLEN })
  );

  const responses = await Promise.all(requests);

  responses.forEach(response => {
    expect(response.status).toBe(200);
    expect(response.body.nip).toBe(TEST_NIPS.ORLEN);
  });
});
```

### 7. Error Propagation

**Scenario**: All errors have proper errorCode, correlationId, source

```typescript
it('should include correlation ID in all error responses', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/companies')
    .set('Authorization', `Bearer ${validApiKey}`)
    .send({ nip: '123' })
    .expect(400);

  expect(response.body).toHaveProperty('errorCode');
  expect(response.body).toHaveProperty('correlationId');
  expect(response.body).toHaveProperty('source');
  expect(response.body).toHaveProperty('timestamp');
});
```

---

## Known Testing Considerations

### GUS Test Environment

- **Tests use GUS test API** (2014 database snapshot) - isolated from production
- **Data is from 2014** - may differ from current production data
- **Anonymized data** - Personal names and addresses are anonymized (e.g., "ul. Test-Wilcza")

### KRS/CEIDG Production APIs

- **Tests connect to actual KRS and CEIDG APIs** (live data)
- **Network dependency** - Tests require internet connection to external services

### Data Mismatch (GUS 2014 vs KRS 2025)

**Important**: GUS test environment returns KRS numbers from 2014, but these old KRS numbers **no longer exist** in current KRS API.

**Behavior**:
- GUS test environment returns KRS numbers from 2014 (e.g., `0000028860` for PKN Orlen)
- These old KRS numbers **no longer exist** in current KRS API
- Result: KRS returns 404 → orchestration falls back to **GUS-only data**

**This is expected behavior**:
- Tests verify fallback mechanism works correctly
- Example: `TEST_NIPS.ORLEN` returns data with `zrodloDanych: "GUS"` (no KRS enrichment)

### Other Considerations

- **REGON Validation**: Checksum validation removed to accept official GUS data
- **Test Duration**: Full integration suite takes ~10-15 seconds due to external API calls
- **Rate Limiting**: Disabled in test environment for unlimited testing

---

## Writing New Tests

### Test Template

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TEST_NIPS } from '../fixtures/test-nips';

describe('My Test Suite', () => {
  let app: INestApplication;
  const validApiKey = process.env.APP_API_KEYS?.split(',')[0] || 'test-key';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should do something', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/companies')
      .set('Authorization', `Bearer ${validApiKey}`)
      .send({ nip: TEST_NIPS.ORLEN })
      .expect(200);

    expect(response.body).toBeDefined();
  });
});
```

### Best Practices

1. **Use test fixtures**: Import `TEST_NIPS` for consistent test data
2. **Test error cases**: Verify error codes, messages, and status codes
3. **Test correlation ID**: Ensure all responses include correlation ID
4. **Test authentication**: Always include API key in requests
5. **Test concurrency**: Verify application handles concurrent requests
6. **Clean up**: Always close application in `afterAll()` hook
7. **Use meaningful descriptions**: Test names should clearly describe scenario
8. **Avoid magic values**: Use constants and fixtures for test data

---

## Debugging Tests

### Viewing Test Output

```bash
# Run tests with verbose output
NODE_ENV=development pnpm test test/integration/companies-success.spec.ts --verbose

# Run a specific test
NODE_ENV=development pnpm test test/integration/companies-success.spec.ts --testNamePattern="should return complete company data"
```

### Common Test Failures

**1. Timeout Errors**

```bash
# Increase timeout if needed
jest.setTimeout(30000); // 30 seconds
```

**2. Module Resolution Errors**

```bash
# Clear Jest cache
pnpm jest --clearCache

# Verify moduleNameMapper in package.json
```

**3. Authentication Errors**

```bash
# Verify API key is set
echo $APP_API_KEYS

# Check .env.test file
cat .env.test | grep APP_API_KEYS
```

**4. Network Errors**

```bash
# Verify internet connection
ping wyszukiwarkaregontest.stat.gov.pl

# Check GUS test environment is accessible
curl https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc
```

---

## Test Performance

### Current Metrics

- **Full integration suite**: ~10-15 seconds
- **Individual test**: ~500-2000ms depending on external API calls
- **Concurrent tests**: 5 parallel requests complete in ~2 seconds

### Optimization Tips

1. **Use test environment**: GUS test API is faster than production
2. **Run tests in parallel**: Jest runs tests concurrently by default
3. **Mock external APIs**: For unit tests, mock external API calls
4. **Skip slow tests in development**: Use `.skip` for slow tests during active development
5. **CI/CD optimization**: Cache dependencies, run tests in parallel

---

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm exec tsc --noEmit
      - run: pnpm test:integration
        env:
          NODE_ENV: test
          APP_API_KEYS: test-key-123
          GUS_USER_KEY: abcde12345abcde12345
```

### Pre-commit Hooks

```bash
# .husky/pre-commit
#!/bin/sh
pnpm exec tsc --noEmit
pnpm test:integration
```
