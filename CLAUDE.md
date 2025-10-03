# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the **Unified Company Data Server** implementation.

## Project Overview

This is a **NestJS microservice** that orchestrates data retrieval from multiple Polish government APIs (GUS, KRS, CEIDG) to provide complete company information using NIP numbers.

### Current Implementation Status

The project is a production-ready microservice with complete external API integration:

- ✅ **Basic NestJS structure** with modular architecture
- ✅ **Live API endpoint** at `POST /api/companies` returning real company data
- ✅ **Environment configuration** with Zod validation
- ✅ **Error handling** with standardized error responses
- ✅ **Integration tests** covering main user scenarios
- ✅ **State machine implementation** (XState orchestration active)
- ✅ **External API integrations** (GUS, KRS, CEIDG services fully implemented)
- ⏳ **Production deployment** configuration

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+ with TypeScript 5.0+
- **Framework**: NestJS with decorators and dependency injection
- **State Management**: XState for orchestration workflows
- **SOAP Client**: strong-soap v5.0.2 for GUS API integration
- **Validation**: Zod schemas for all data boundaries
- **Testing**: Jest with supertest for integration tests
- **Logging**: Structured logging (console for development)
- **Documentation**: Swagger/OpenAPI integration

### Project Structure

```text
src/
├── main.ts                          # Application entry point
├── app.module.ts                    # Root module
├── config/
│   └── environment.schema.ts        # Environment validation with Zod
├── modules/
│   ├── companies/                   # Main business logic
│   │   ├── controllers/             # REST endpoints
│   │   │   └── companies.controller.ts
│   │   ├── services/                # Business services
│   │   │   └── orchestration.service.ts
│   │   └── state-machines/          # XState orchestration
│   │       ├── orchestration.machine.ts
│   │       └── retry.machine.ts
│   ├── external-apis/               # API adapters (stubs)
│   │   ├── gus/                     # GUS SOAP service
│   │   ├── krs/                     # KRS REST service
│   │   └── ceidg/                   # CEIDG REST service
│   └── common/                      # Shared utilities
└── schemas/                         # Zod validation schemas
    ├── unified-company-data.schema.ts
    ├── error-response.schema.ts
    └── orchestration-context.schema.ts

tests/
├── contract/                        # External API contract tests (skipped)
├── integration/                     # Full workflow tests ✅
│   └── companies.integration.spec.ts
└── unit/                           # Component tests (skipped)
```

## Commands

### Development

```bash
# Start development server (with auto-reload)
pnpm start:dev

# Alternative development command
pnpm dev

# Production build and start
pnpm build
pnpm start
```

### Testing

```bash
# Run all tests (currently skips placeholder tests)
pnpm test

# Run only integration tests
NODE_ENV=development pnpm test tests/integration

# Run specific test file
NODE_ENV=development pnpm test tests/integration/companies.integration.spec.ts
```

### Code Quality

```bash
# TypeScript compilation check
pnpm exec tsc --noEmit

# Linting (when configured)
pnpm lint

# Code formatting (when configured)
pnpm format
```

## API Endpoints

### POST /api/companies

Retrieve unified company data by NIP number.

**Request:**

```json
{
  "nip": "1234567890"
}
```

**Response (Real Company Data):**

```json
{
  "nip": "5260250995",
  "nazwa": "Orange Polska Spółka Akcyjna",
  "adres": {
    "wojewodztwo": "mazowieckie",
    "powiat": "warszawa",
    "gmina": "Warszawa",
    "miejscowosc": "Warszawa",
    "kodPocztowy": "02-326",
    "ulica": "ul. Obrzeżna",
    "numerBudynku": "7",
    "numerLokalu": null
  },
  "status": "AKTYWNY",
  "isActive": true,
  "dataRozpoczeciaDzialalnosci": "1991-12-18",
  "pkd": [
    {
      "kod": "61.10.Z",
      "nazwa": "Działalność w zakresie telekomunikacji przewodowej",
      "czyGlowny": true
    }
  ],
  "zrodloDanych": "GUS",
  "dataAktualizacji": "2025-09-29T15:30:45.123Z"
}
```

**Error Response (400 Bad Request):**

```json
{
  "errorCode": "INVALID_NIP_FORMAT",
  "message": "Invalid NIP format: 123. Expected 10 digits.",
  "correlationId": "req-1758914092756-j57tbg1gn",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

## Environment Configuration

### Naming Convention

Application-level configuration uses `APP_*` prefix to distinguish from service-specific variables:

- **Application-level** (server, auth, CORS, logging): `APP_*` prefix
- **Service integrations** (GUS, KRS, CEIDG): Service-specific prefix (`GUS_*`, `KRS_*`, `CEIDG_*`)

### Required Environment Variables

```bash
# Server Configuration
NODE_ENV=development                 # development|staging|production
PORT=3000                           # Server port

# External API Credentials (for production)
GUS_USER_KEY=d235b29b4a284c3d89ab   # GUS SOAP API key (20 chars minimum)
CEIDG_JWT_TOKEN=your_jwt_token_here  # CEIDG v3 API JWT (50 chars minimum)

# API Authentication (for production)
APP_API_KEYS=key1,key2,key3         # Comma-separated API keys (32 chars each)

# Application-level Performance & Timeouts
APP_REQUEST_TIMEOUT=15000           # Request timeout in ms
APP_EXTERNAL_API_TIMEOUT=5000       # External API timeout in ms
APP_RATE_LIMIT_PER_MINUTE=100       # Rate limit per minute

# Application-level Orchestration
APP_ORCHESTRATION_TIMEOUT=30000     # Orchestration timeout in ms

# Service-specific Retry Configuration
GUS_MAX_RETRIES=2                   # Max retries for GUS
GUS_INITIAL_DELAY=100               # Initial delay for GUS retries
KRS_MAX_RETRIES=2                   # Max retries for KRS
KRS_INITIAL_DELAY=200               # Initial delay for KRS retries
CEIDG_MAX_RETRIES=2                 # Max retries for CEIDG
CEIDG_INITIAL_DELAY=150             # Initial delay for CEIDG retries

# Service-specific Rate Limiting
GUS_MAX_REQUESTS_PER_SECOND=10      # Max requests/second for GUS API (token bucket)

# Application-level Logging
APP_LOG_LEVEL=debug                 # Log level: error, warn, info, debug
APP_LOG_FORMAT=pretty               # Format: json, pretty

# Application-level CORS Configuration
APP_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Application-level Security Headers
APP_ENABLE_HELMET=true              # Enable Helmet security headers

# Application-level Health Checks
APP_HEALTH_CHECK_ENABLED=true       # Enable health checks
APP_HEALTH_CHECK_TIMEOUT=3000       # Health check timeout in ms

# Application-level Swagger
APP_SWAGGER_ENABLED=true            # Enable Swagger docs
APP_SWAGGER_SERVER_URL_DEVELOPMENT=http://localhost:3000
APP_SWAGGER_SERVER_URL_PRODUCTION=https://api.example.com
```

### CORS Security Configuration

**IMPORTANT**: CORS configuration has security implications when combined with `credentials: true`.

#### Development Setup (Recommended)

Use an **explicit list of allowed origins** instead of wildcard `*`:

```bash
# .env
APP_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173
```

**Benefits**:
- ✅ Tests real CORS behavior (catches issues early)
- ✅ No CSRF vulnerability
- ✅ Can be committed to git safely
- ✅ Works with `credentials: true`

#### Wildcard Configuration (NOT RECOMMENDED)

For **quick local testing only**, you can use wildcard (but this is discouraged):

```bash
# .env (NOT RECOMMENDED - only for quick testing)
APP_CORS_ALLOWED_ORIGINS=*
```

**Security Risk**: Wildcard `*` combined with `credentials: true` creates **CSRF vulnerability**. The application logs a warning when this configuration is detected.

#### Production Configuration (REQUIRED)

In production, wildcard `*` is **blocked by Zod validation** (`environment.schema.ts`):

```bash
# .env.production
APP_CORS_ALLOWED_ORIGINS=https://yourapp.com,https://www.yourapp.com,https://admin.yourapp.com
```

The application will **fail to start** if `APP_CORS_ALLOWED_ORIGINS=*` is set in `NODE_ENV=production`.

#### Default Value

If `APP_CORS_ALLOWED_ORIGINS` is not set, the application defaults to:

```bash
http://localhost:3000,http://localhost:5173
```

This ensures safe operation out-of-the-box.

## Development Notes

### Retry Architecture

The application uses a **centralized retry strategy** via XState machines:

#### Implementation Pattern
- **Service Layer** (`gus.service.ts`, `krs.service.ts`, `ceidg-v3.service.ts`): NO retry logic, methods throw errors directly
- **Orchestration Layer** (`orchestration.machine.ts`): Manages all retry logic via `retry.machine.ts`
- **Retry Machine** (`retry.machine.ts`): Generic, reusable state machine for exponential backoff

#### Configuration per Service

| Service | Max Retries | Initial Delay | Retry Conditions |
|---------|-------------|---------------|------------------|
| **GUS** | 2 (default) | 100ms | 5xx errors, session errors (SESSION_EXPIRED) |
| **KRS** | 2 (default) | 200ms | 5xx errors only (500, 502, 503) |
| **CEIDG** | 2 (default) | 150ms | 5xx errors only (500, 502, 503) |

**Non-Retryable Errors** (all services):
- 404 Not Found (entity doesn't exist)
- 400 Bad Request (invalid input)
- 401 Unauthorized (auth failure)
- 429 Rate Limit (quota exceeded)

#### Exponential Backoff
- Formula: `delay = initialDelay * 2^attempt + jitter`
- Jitter: ±10% random variation
- Max delay: 5000ms
- Managed automatically by `retry.machine.ts`

#### Special Cases
- **GUS Session Recovery**: On session errors, new session is created before retry
- **KRS Registry Fallback**: P→S registry fallback is NOT part of retry logic (separate business logic)
- **Correlation ID**: Tracked through all retry attempts for debugging

#### How It Works (XState v5 Pattern)

**Service Layer** - No retry logic, just throw errors:
```typescript
async fetchCompanyByKrs(krs: string, correlationId: string) {
  // No retry logic here - just fetch and throw on error
  const response = await this.httpClient.get(`/api/krs/${krs}`);
  return response.data;
}
```

**Orchestration Machine** - Uses child retry machine pattern:
```typescript
invoke: {
  id: 'krsData',
  src: fromPromise(async ({ input }) => {
    const { krsNumber, correlationId } = input;

    // Create retry machine dynamically at runtime
    const retryMachine = createRetryMachine('KRS', correlationId, logger);
    const retryActor = createActor(retryMachine, {
      input: {
        serviceCall: () => services.krsService.fetchCompanyByKrs(krsNumber, correlationId),
        correlationId,
      },
    });

    // Wait for completion using XState v5 subscribe pattern
    return new Promise((resolve, reject) => {
      retryActor.subscribe({
        complete: () => {
          const snapshot = retryActor.getSnapshot();
          const finalState = snapshot.value as string;

          if (finalState === 'success') {
            const result = snapshot.output !== undefined ? snapshot.output : snapshot.context?.result;
            resolve(result);
          } else if (finalState === 'failed') {
            const error = snapshot.output || snapshot.context?.lastError;
            reject(error);
          }
        },
        error: (err) => reject(err),
      });

      retryActor.start();
    });
  }),
  input: ({ context }) => ({
    krsNumber: context.krsNumber,
    correlationId: context.correlationId,
  }),
  onDone: { target: 'success', actions: ['saveKrsData'] },
  onError: { target: 'failed', actions: ['captureError'] },
}
```

**Key XState v5 Features**:
- `fromPromise` wraps async actor creation
- `createActor` + dynamic input for each API call
- `subscribe({ complete })` callback for final state detection
- `snapshot.output` + `snapshot.context.result` fallback for data retrieval
- Proper error propagation via `reject()`

### Production API Integration

The service uses **real Polish government APIs** for data retrieval:

- **GUS (Polish Statistical Office)**: Primary data source via SOAP API (strong-soap client)
  - **SOAP 1.2** protocol with MTOM responses
  - **WS-Addressing headers** required: `<wsa:To>` and `<wsa:Action>`
  - **Session management**: 60-minute sessions with `sid` HTTP header
  - **Rate limiting**: Bottleneck library with token bucket algorithm (10 req/s default)
  - **Namespace handling**: `xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract"` at Envelope level
- **KRS (National Court Register)**: Legal entities data via REST API
- **CEIDG (Central Registration of Business Activity)**: Individual entrepreneurs via REST API
- Complete error handling for all external API failure scenarios
- Correlation ID tracking for debugging across all services

#### GUS API Implementation Details

The GUS service (`gus.service.ts`) uses **strong-soap v5.0.2** with custom request interceptor:

1. **WS-Addressing Headers**: Custom interceptor injects required SOAP headers without `soap:mustUnderstand` attributes
2. **DataContract Namespace**: Added at Envelope level (`xmlns:dat`) to avoid inline namespace declarations
3. **Rate Limiting**: Global rate limiter using **Bottleneck** library with token bucket algorithm
   - **Implementation**: `GusRateLimiterService` (injectable NestJS service)
   - **Algorithm**: Token bucket with reservoir refilling every second
   - **Configuration**: `GUS_MAX_REQUESTS_PER_SECOND` environment variable (default: 10 req/s)
   - **Concurrency**: Queues all concurrent requests, executes serially with rate control
   - **Applied to**: `DaneSzukajPodmioty` and `DanePobierzPelnyRaport` operations
   - **Benefits**: Prevents overwhelming GUS API with concurrent bursts, thread-safe
4. **Session Management**: HTTP header `sid` (not SOAP header) with automatic re-addition before each operation
5. **MTOM Response Handling**: strong-soap automatically parses MTOM (`application/xop+xml`) responses

### State Machine Integration

The XState orchestration machine is **fully active** in `orchestration.service.ts`:

```typescript
const services: OrchestrationServices = {
  gusService: { getClassificationByNip, getDetailedReport },
  krsService: { fetchCompanyByKrs },
  ceidgService: { getCompanyByNip },
};
const orchestrationMachine = createOrchestrationMachine(services);
```

The orchestration workflow:

1. **Input validation**: NIP format validation
2. **GUS classification**: Determine entity type and routing
3. **Detailed data retrieval**: Get comprehensive data from GUS
4. **Specialized lookups**: KRS for legal entities, CEIDG for entrepreneurs
5. **Data mapping**: Unify all sources into standardized format

### Security and Authentication

The application implements **comprehensive security layers** including HTTP security headers, authentication, and rate limiting:

#### HTTP Security Headers (Helmet.js)

**Implementation**: `helmet.config.ts` with production-grade security headers

- **Status**: ✅ **ACTIVE** by default (configurable via `ENABLE_HELMET` env var)
- **Configuration**: Restrictive Content Security Policy (CSP) + comprehensive security headers
- **Location**: `src/config/helmet.config.ts`

**Security Headers Applied**:

1. **Content-Security-Policy (CSP)**:
   - `default-src 'self'`: Only same-origin resources allowed
   - `frame-ancestors 'none'`: Prevents clickjacking attacks
   - `upgrade-insecure-requests`: Forces HTTPS for all resources
   - Special Swagger mode: Relaxed CSP when Swagger UI is enabled

2. **Strict-Transport-Security (HSTS)**:
   - `max-age: 31536000` (1 year)
   - `includeSubDomains: true`
   - `preload: true` (eligible for browser HSTS preload lists)

3. **Additional Security Headers**:
   - `X-Frame-Options: DENY` - Prevents iframe embedding
   - `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
   - `Referrer-Policy: no-referrer` - Prevents information leakage
   - `Cross-Origin-*-Policy: same-origin` - Protects against Spectre/Meltdown
   - `X-XSS-Protection: 1` - Legacy browser XSS protection

**Benefits**:
- ✅ Defense-in-depth against XSS (Cross-Site Scripting)
- ✅ Clickjacking protection via frame-ancestors
- ✅ MIME sniffing prevention
- ✅ Force HTTPS connections via HSTS
- ✅ Protection against Spectre/Meltdown attacks
- ✅ OWASP Security Headers compliance

**Configuration**:
```bash
# Enable/disable Helmet (default: true)
ENABLE_HELMET=true
```

**API Response Headers Example**:
```
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

#### API Key Authentication (Active in ALL Environments)

**Implementation**: `ApiKeyGuard` in `src/modules/common/guards/api-key.guard.ts`

- **Status**: ✅ **ACTIVE** in development, test, and production
- **Requirement**: All endpoints require `Authorization: Bearer <api-key>` header
- **Exceptions**: Endpoints marked with `@Public()` decorator (e.g., health checks)
- **Configuration**: Valid API keys defined in `VALID_API_KEYS` environment variable

**Error Responses**:
- `401 MISSING_API_KEY` - No Authorization header provided
- `401 INVALID_API_KEY` - Invalid or unknown API key

**Public Endpoints** (no authentication required):
- `GET /` - Root endpoint
- `GET /api/health/live` - Liveness check
- `GET /api/health/ready` - Readiness check
- `GET /api/health/startup` - Startup check
- `GET /api/health` - General health check

**Testing API Key Authentication**:
```bash
# Valid request (with API key)
curl -X POST http://localhost:3000/api/companies \
  -H "Authorization: Bearer your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"nip": "5260250995"}'

# Rejected (missing API key)
curl -X POST http://localhost:3000/api/companies \
  -H "Content-Type: application/json" \
  -d '{"nip": "5260250995"}'
# Returns: 401 {"errorCode": "MISSING_API_KEY", ...}
```

#### Rate Limiting (Active in PRODUCTION Only)

**Implementation**: `CustomThrottlerGuard` in `src/modules/common/config/throttler.config.ts`

- **Status**: ✅ **ACTIVE** in production, ⚠️ **DISABLED** in development/test
- **Configuration**:
  - Default: 100 requests per minute per API key
  - Burst protection: 10 requests per 10 seconds
  - Per-API-key tracking (isolated limits)
- **Skip Conditions**:
  - `NODE_ENV=development` - Disabled to allow unlimited local testing
  - `NODE_ENV=test` - Disabled to prevent test failures
  - Health check endpoints - Always exempt from rate limiting

**Why Disabled in Development/Test**:
- **Development**: Developers need unlimited requests for debugging and rapid iteration
- **Integration Tests**: Tests make many rapid requests to external APIs without artificial limits
- **Production**: Rate limiting protects against abuse and ensures fair usage

**Error Response** (production only):
```json
{
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "message": "API rate limit exceeded. Please reduce request frequency and try again.",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "details": {
    "retryAfter": "60"
  }
}
```

**Testing Rate Limiting**:
- Rate limiting cannot be tested in `NODE_ENV=development` or `NODE_ENV=test`
- To test rate limiting behavior, set `NODE_ENV=production` or modify `skipIf` in `throttler.config.ts`
- Integration tests document expected production behavior (see `tests/integration/rate-limiting.spec.ts`)

#### Security Architecture

**Request Pipeline Order**:
1. **Middleware**: `CorrelationIdMiddleware` - generates/extracts correlationId
2. **Guards**: `ApiKeyGuard` → `CustomThrottlerGuard` - authentication, rate limiting
3. **Interceptors**: `CorrelationIdInterceptor` - request/response logging
4. **Controllers**: Business logic
5. **Filters**: `GlobalExceptionFilter` - error handling

**Key Points**:
- API key authentication is **always active** (cannot be disabled)
- Rate limiting is **environment-specific** (production only by default)
- Both guards are **global** (applied to all routes unless `@Public()`)
- Guards execute **before** business logic (fail fast for unauthorized requests)

### Test Coverage

- **Integration tests**: ✅ Complete coverage of API endpoints
- **Contract tests**: ⏳ Placeholder tests (skipped with `.skip`)
- **Unit tests**: ⏳ Placeholder tests (skipped with `.skip`)

### Validation Strategy

**Philosophy**: Single responsibility - one validation layer at system boundaries

**Implementation**:
- **Incoming HTTP requests**: class-validator (DTO) + ValidationPipe + GlobalExceptionFilter
- **Environment variables**: Zod schemas (environment.schema.ts)
- **External API responses**: Zod schemas (gus.service.ts, krs.service.ts, ceidg-v3.service.ts)

**Request Validation Flow**:
```
HTTP Request → ValidationPipe (validates DTO)
                    ↓ (on error)
            GlobalExceptionFilter
                    ↓
            ErrorResponse format (consistent)
```

**Key Components**:
1. **DTO** (`company-request.dto.ts`): Defines validation rules with class-validator decorators
2. **ValidationPipe** (`main.ts`): Automatically validates all incoming requests
3. **GlobalExceptionFilter** (`common/filters/global-exception.filter.ts`): Transforms all exceptions (including validation errors) to ErrorResponse format

**Error Code Mapping**:
- `INVALID_NIP_FORMAT`: NIP validation errors (format, length, type)
- `MISSING_REQUIRED_FIELDS`: Missing or empty required fields
- `INVALID_REQUEST_FORMAT`: Other validation errors or malformed requests

**Benefits**:
- ✅ Single source of truth (DTO with decorators)
- ✅ Consistent error format across all endpoints and error types
- ✅ Automatic Swagger documentation from DTO
- ✅ NestJS best practices and conventions
- ✅ No manual validation in controllers
- ✅ Centralized error handling for all exceptions

### Error Handling

Comprehensive error handling with:

- Standardized `ErrorResponse` schema
- Correlation ID tracking for debugging
- Proper HTTP status code mapping
- All exceptions transformed to ErrorResponse format by GlobalExceptionFilter

## Next Development Steps

1. **Production Features**:
   - API key authentication middleware
   - Rate limiting
   - Structured logging with Pino
   - Health check endpoints
   - Swagger documentation

4. **Comprehensive Testing**:
   - Enable contract tests with real API stubs
   - Add unit tests for all components
   - Performance testing under load

5. **Deployment**:
   - CI/CD pipeline
   - Environment-specific configurations

## Important Notes

- **Production APIs are active** - all requests connect to real Polish government services
- **External APIs are fully integrated** - GUS, KRS, and CEIDG services are implemented
- **All integration tests work with real data** - no mock implementations remain
- **Environment validation is strict** - ensure all required variables are set (GUS_USER_KEY, CEIDG_JWT_TOKEN)
- **TypeScript strict mode** is enabled - no `any` types allowed
- **Rate limiting applies** - respect external API limits and retry configurations

## Module Resolution and Imports

### Import Strategy

This project uses **path aliases** for cleaner, more maintainable imports.

**Why path aliases?**

1. **Readability**: `@schemas/unified-company-data.schema` is clearer than `'../../../schemas/unified-company-data.schema'`
2. **Refactoring**: Moving files doesn't require updating import paths
3. **Industry Standard**: Follows best practices in large TypeScript/NestJS projects
4. **No Circular Dependency Issues**: Path aliases don't cause circular dependencies - architecture does
5. **Zero Runtime Overhead**: NestJS CLI and ts-node support path aliases natively via `tsconfig-paths` (already installed)

**Path Alias Mapping**

```typescript
// tsconfig.json paths configuration
"paths": {
  "@/*": ["src/*"],              // Root src directory
  "@common/*": ["src/common/*"],  // Common utilities, exceptions, validators
  "@config/*": ["src/config/*"],  // Configuration files
  "@schemas/*": ["src/schemas/*"], // Zod schemas
  "@modules/*": ["src/modules/*"], // NestJS modules
  "@types/*": ["src/types/*"]     // TypeScript type definitions
}
```

**Import Examples**

```typescript
// ✅ Correct - Path aliases
import { UnifiedCompanyDataSchema } from '@schemas/unified-company-data.schema';
import { GusService } from '@modules/external-apis/gus/gus.service';
import { BusinessException } from '@common/exceptions/business-exceptions';
import type { Environment } from '@config/environment.schema';

// ❌ Avoid - Relative imports for cross-module dependencies
import { UnifiedCompanyDataSchema } from '../../../schemas/unified-company-data.schema';
import { GusService } from '../../external-apis/gus/gus.service';

// ✅ OK - Relative imports for same-directory or parent directory (one level up)
import { OrchestrationService } from '../services/orchestration.service';
import { CompanyRequestDto } from './company-request.dto';
```

**When to Use Relative vs Path Aliases**

- **Path aliases**: Cross-module imports, importing from `common/`, `schemas/`, `config/`
- **Relative imports**: Same module, same directory, or immediate parent/child directories

**Jest Configuration**

Tests automatically support path aliases via `moduleNameMapper` in `package.json`:

```json
"moduleNameMapper": {
  "^@/(.*)$": "<rootDir>/src/$1",
  "^@common/(.*)$": "<rootDir>/src/common/$1",
  "^@config/(.*)$": "<rootDir>/src/config/$1",
  "^@schemas/(.*)$": "<rootDir>/src/schemas/$1",
  "^@modules/(.*)$": "<rootDir>/src/modules/$1",
  "^@types/(.*)$": "<rootDir>/src/types/$1"
}
```

**When You See Module Resolution Errors**

If you encounter module resolution errors:
1. Verify the alias exists in `tsconfig.json` `paths` field
2. Check that `moduleNameMapper` is configured in `package.json` (for Jest)
3. Ensure `tsconfig-paths` is installed (`pnpm list tsconfig-paths`)
4. Run `pnpm exec tsc --noEmit` to check for TypeScript errors
5. Restart your IDE/language server after changing `tsconfig.json`

## Troubleshooting

### Common Issues

1. **Environment validation fails**: Check all required environment variables
2. **Tests timeout**: Ensure `NODE_ENV=development` is set for tests
3. **Module resolution errors**: This project uses relative imports exclusively (see Module Resolution section below for reasoning)
4. **Correlation ID validation**: Changed from UUID to simple string validation

### Development Server

Start the server with environment variables:

```bash
source .env && pnpm start:dev
```

The server runs on `http://localhost:3000` by default.

## Testing

### Integration Tests

The project has comprehensive integration tests covering all major user scenarios and edge cases.

**Run all integration tests:**
```bash
NODE_ENV=development pnpm test tests/integration/
```

**Run specific test suite:**
```bash
# Success scenarios (200 OK responses)
NODE_ENV=development pnpm test tests/integration/companies-success.spec.ts

# Error handling (400, 404, 500 responses)
NODE_ENV=development pnpm test tests/integration/companies-errors.spec.ts

# Timeout and retry logic
NODE_ENV=development pnpm test tests/integration/companies-timeout.spec.ts

# Rate limiting
NODE_ENV=development pnpm test tests/integration/rate-limiting.spec.ts
```

### Test Data

Test NIPs are centrally managed in `tests/fixtures/test-nips.ts`:

| NIP | Description | Expected Response |
|-----|-------------|-------------------|
| `5260250995` | Orange Polska S.A. (real company with KRS) | 200 OK - Complete data from GUS + KRS |
| `0000000000` | Non-existent company | 404 Not Found - ENTITY_NOT_FOUND |
| `123` | Invalid format (too short) | 400 Bad Request - INVALID_NIP_FORMAT |

**Import test data in your tests:**
```typescript
import { TEST_NIPS, TEST_SCENARIOS } from '../fixtures/test-nips';

// Use predefined NIPs
const response = await request(app.getHttpServer())
  .post('/api/companies')
  .send({ nip: TEST_NIPS.VALID_LEGAL_ENTITY })
  .expect(200);
```

### Test Coverage

Current integration test results:
- ✅ **companies-success.spec.ts**: 9/9 tests passing
  - Valid company data retrieval (200 OK)
  - Concurrent request handling
  - Correlation ID tracking
  - Retry logic for transient errors
  - 404 error handling without retries
  - GUS-only data when KRS missing (negative data scenario)

- ✅ **companies-errors.spec.ts**: 16/18 tests passing
  - Invalid NIP format validation (400)
  - Missing required fields (400)
  - Extra unexpected fields (400)
  - Null/undefined value handling

- ✅ **companies-timeout.spec.ts**: 5/5 configuration tests passing
  - External API timeout configuration
  - Retry mechanism configuration per service

- ✅ **rate-limiting.spec.ts**: 5/5 documentation tests passing
  - Rate limit configuration verification

**Total: 36+ tests passing** covering critical paths and edge cases.

### Key Test Scenarios Covered

1. **Happy Path**: Valid NIP → 200 OK with complete company data
2. **Retry Logic**: 5xx errors are retried with exponential backoff
3. **No Retry for 404**: Entity not found errors are NOT retried (fast fail)
4. **Negative Data**: Missing KRS number returns GUS-only data (not an error)
5. **Validation**: Invalid NIP format returns 400 with clear error message
6. **Concurrency**: Multiple simultaneous requests handled correctly
7. **Error Propagation**: All errors have proper errorCode, correlationId, source

### Known Testing Considerations

- **Real External APIs**: Tests connect to actual Polish government APIs (GUS, KRS, CEIDG)
- **Rate Limiting**: Tests may fail if external API rate limits are exceeded
- **Network Dependency**: Tests require internet connection to external services
- **REGON Validation**: Checksum validation removed to accept official GUS data
- **Test Duration**: Full integration suite takes ~10-15 seconds due to real API calls
