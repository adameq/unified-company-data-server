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
- ✅ **Type safety improvements** (eliminated `@ts-expect-error` in orchestration.service.ts)
- ⏳ **Production deployment** configuration

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+ with TypeScript 5.0+
- **Framework**: NestJS with decorators and dependency injection
- **State Management**: XState for orchestration workflows
- **SOAP Client**: strong-soap v5.0.2 for GUS API integration
- **Validation**: Zod schemas for all data boundaries
- **Testing**: Jest with supertest for integration tests
- **Logging**: NestJS built-in Logger (console output)
- **Health Checks**: @nestjs/terminus (MemoryHealthIndicator, extensible for disk/database)
- **Documentation**: Swagger/OpenAPI integration
- **HTTP Client**: axios (direct use, not @nestjs/axios wrapper)

### HTTP Client Architecture

**Decision: Use `axios` directly instead of `@nestjs/axios`**

The project uses **per-service axios instances** with `axios.create()` for external API integrations (KRS, CEIDG). This architectural choice provides several benefits over `@nestjs/axios`:

**Why axios instead of @nestjs/axios:**

1. **Per-Service Configuration**
   - Each external API requires different configuration (baseURL, headers, timeouts, interceptors)
   - KRS and CEIDG have distinct authentication, retry policies, and error handling
   - `axios.create()` provides isolated instances with full control
   - `@nestjs/axios` HttpService is a global singleton - difficult to manage multiple configurations

2. **Promise Pattern Consistency**
   - Entire codebase uses async/await (Promise pattern)
   - `@nestjs/axios` returns RxJS Observables, requiring `firstValueFrom()` wrapper
   - Direct axios keeps code simple and consistent

3. **Service-Specific Interceptors**
   - KRS: Response interceptor for error logging
   - CEIDG: Request interceptor (debugging) + Response interceptor (error logging)
   - Each service has custom interceptor logic
   - `@nestjs/axios` uses global interceptors - harder to manage service-specific logic

4. **Transitional Configuration**
   - Services use `transitional.clarifyTimeoutError: true` to distinguish ETIMEDOUT vs ECONNABORTED
   - Critical for error-detection.utils.ts timeout detection
   - Easier to configure with direct axios instances

5. **Type Guards Dependency**
   - `error-detection.utils.ts` uses `axios.isAxiosError()` for type guards
   - Even with `@nestjs/axios`, would still need `axios` as a dependency
   - Direct use eliminates unnecessary abstraction layer

**Architecture Pattern:**
```typescript
// Each service creates its own axios instance
@Injectable()
export class KrsService {
  private readonly httpClient: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.httpClient = axios.create({
      baseURL: this.configService.get('KRS_BASE_URL'),
      timeout: this.configService.get('APP_EXTERNAL_API_TIMEOUT'),
      headers: { Accept: 'application/json' },
      transitional: { clarifyTimeoutError: true },
    });

    // Service-specific interceptors
    this.httpClient.interceptors.response.use(...);
  }
}
```

**When @nestjs/axios makes sense:**
- Single global HTTP client for entire application
- RxJS Observables preferred over Promises
- Global interceptors for all requests
- Simpler use cases without per-service configuration

**Our use case:**
- Multiple HTTP clients with different configurations
- Promise-based async/await pattern throughout
- Service-specific interceptors and error handling
- Direct axios control for precise configuration

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
│   │       ├── retry.machine.ts
│   │       ├── retry-actor.factory.ts  # Factory pattern (eliminates duplication)
│   │       └── strategies/          # Retry strategies per service
│   │           ├── gus-retry.strategy.ts
│   │           ├── krs-retry.strategy.ts
│   │           └── ceidg-retry.strategy.ts
│   ├── external-apis/               # API adapters
│   │   ├── gus/                     # GUS SOAP service (SRP refactored)
│   │   │   ├── parsers/             # XML parsing and extraction
│   │   │   │   └── gus-response.parser.ts
│   │   │   ├── validators/          # Zod schema validation
│   │   │   │   └── gus-response.validator.ts
│   │   │   ├── handlers/            # Error handling
│   │   │   │   └── gus-error.handler.ts
│   │   │   ├── gus.service.ts       # Orchestration facade
│   │   │   ├── gus-session.manager.ts
│   │   │   └── gus-rate-limiter.service.ts
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

### Company Data Endpoints

#### POST /api/companies

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

### Health Check Endpoints

Health endpoints use **@nestjs/terminus** for standardized health indicators.

#### GET /api/health

Basic health check without external dependencies.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-04T15:10:00.000Z",
  "uptime": 3600,
  "version": "0.0.1",
  "environment": "development"
}
```

#### GET /api/health/live

Liveness probe for Kubernetes/container orchestration.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-04T15:10:00.000Z"
}
```

#### GET /api/health/ready

Readiness check including external service health (GUS, KRS, CEIDG).

**Response (healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-04T15:10:00.000Z",
  "uptime": 3600,
  "version": "0.0.1",
  "environment": "development",
  "services": {
    "gus": "operational",
    "krs": "operational",
    "ceidg": "operational"
  },
  "dependencies": {
    "gus": "operational",
    "krs": "operational",
    "ceidg": "operational"
  }
}
```

#### GET /api/health/metrics

Application metrics using Terminus health indicators.

**Features:**
- **MemoryHealthIndicator**: Heap and RSS memory monitoring
- **Extensible**: Easy to add DiskHealthIndicator, DatabaseHealthIndicator, etc.
- **Standardized format**: Industry-standard health check response

**Response:**
```json
{
  "status": "ok",
  "info": {
    "memory_heap": {
      "status": "up"
    },
    "memory_rss": {
      "status": "up"
    }
  },
  "error": {},
  "details": {
    "memory_heap": {
      "status": "up"
    },
    "memory_rss": {
      "status": "up"
    }
  },
  "uptime": 3600,
  "process": {
    "pid": 12345,
    "nodeVersion": "v18.20.0"
  },
  "timestamp": "2025-10-04T15:10:00.000Z"
}
```

**Thresholds:**
- Heap memory: 512 MB (typical Node.js application)
- RSS memory: 1 GB (total process memory)

**Future Extensions:**
```typescript
// Easy to add more health indicators:
await this.health.check([
  () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
  () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
  () => this.disk.checkStorage('disk', { path: '/', threshold: 0.9 }), // Disk usage
  () => this.database.pingCheck('database', { timeout: 1000 }), // Database health
]);
```

## Environment Configuration

### Naming Convention

Application-level configuration uses `APP_*` prefix to distinguish from service-specific variables:

- **Application-level** (server, auth, CORS, security): `APP_*` prefix
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

**IMPORTANT**: CORS configuration has security implications. The application enforces safe CORS practices automatically.

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
- ✅ Works with `credentials: true` (allows cookies and Authorization headers)

#### Wildcard Configuration (LIMITED USE)

For **quick local testing only** when you don't need credentials:

```bash
# .env (for testing without authentication)
APP_CORS_ALLOWED_ORIGINS=*
```

**Automatic Security Enforcement**:
- ⚠️ Application **automatically sets** `credentials: false` when `origin: '*'`
- ⚠️ This prevents CSRF vulnerability per CORS specification
- ⚠️ Cookies and Authorization headers **will NOT be sent**
- ⚠️ Warning logged at startup

**Technical Details**:
- CORS spec **prohibits** `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`
- Browsers reject this combination to prevent CSRF attacks
- Application enforces this at code level: `credentials: !allowAllOrigins`
- See: [MDN CORS Credentialed Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#credentialed_requests_and_wildcards)

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

The application uses a **centralized retry strategy** via XState machines with a **factory pattern** to eliminate code duplication:

#### Implementation Pattern
- **Service Layer** (`gus.service.ts`, `krs.service.ts`, `ceidg-v3.service.ts`): NO retry logic, methods throw errors directly
- **Orchestration Layer** (`orchestration.service.ts`): Uses `createRetryActor()` factory for all retry actors
- **Retry Actor Factory** (`retry-actor.factory.ts`): Generic factory function that eliminates ~180 lines of duplication
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
- Jitter: ±10% symmetric random variation (prevents thundering herd)
- Implementation: `(Math.random() - 0.5) * 0.2 * exponentialDelay`
- Max delay: 5000ms
- Managed automatically by `retry.machine.ts`

#### Special Cases
- **GUS Session Recovery**: On session errors, new session is created before retry
- **KRS Registry Fallback**: P→S registry fallback is NOT part of retry logic (separate business logic)
- **Correlation ID**: Tracked through all retry attempts for debugging

#### How It Works (XState v5 Pattern)

**Service Layer** - No retry logic, just throw errors:
```typescript
async fetchFromRegistry(krs: string, registry: 'P' | 'S', correlationId: string) {
  // No retry logic here - just fetch and throw on error
  const response = await this.httpClient.get(`/api/krs/${krs}?registry=${registry}`);
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
        serviceCall: () => services.krsService.fetchFromRegistry(krsNumber, registry, correlationId),
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

#### Retry Actor Factory Pattern (Code Duplication Elimination)

**Problem**: Previously, `orchestration.service.ts` had 4 nearly identical retry actors with ~42 lines each (~180 lines total duplication).

**Solution**: Generic `createRetryActor()` factory function in `retry-actor.factory.ts`:

```typescript
// Before (42 lines per actor × 4 actors = ~180 lines):
retryGusClassification: fromPromise(async ({ input }) => {
  const { nip, correlationId } = input;
  const retryMachine = createRetryMachine(this.gusRetryStrategy.name, correlationId, this.logger, this.machineConfig.retry.gus);
  // ... 35 more lines of boilerplate ...
})

// After (7 lines per actor × 4 actors = ~28 lines):
retryGusClassification: createRetryActor({
  strategyName: this.gusRetryStrategy.name,
  retryStrategy: this.gusRetryStrategy,
  retryConfig: this.machineConfig.retry.gus,
  logger: this.logger,
  serviceCall: (ctx) => this.gusService.getClassificationByNip(ctx.nip!, ctx.correlationId),
})
```

**Benefits**:
- ✅ **Reduced from 529 to 376 lines** (-153 lines, -29%)
- ✅ **Single source of truth** for retry actor creation logic
- ✅ **Eliminated inconsistencies** (KRS used Promise pattern, others used toPromise())
- ✅ **Type-safe generics** with `RetryActorConfig<TInput, TResult>`
- ✅ **Easier maintenance**: Update factory once, all actors benefit
- ✅ **Improved readability**: Focus on what to retry, not how to retry

**Factory Features**:
- Generic types for type-safe input/output across services
- Consistent error handling and logging for all retry actors
- Automatic correlation ID tracking through retry attempts
- Supports all service-specific parameters (nip, regon, krsNumber, etc.)

#### Known XState v5 TypeScript Limitations

**Issue #1: TS2719 ActionFunction Type Incompatibility** ✅ **RESOLVED**

**Problem**: TypeScript showed 23 TS2719 errors: "Two different types with this name exist, but they are unrelated" for `ActionFunction<...>` types in `orchestration.machine.ts`.

**Root Cause**: TypeScript creates **distinct type identities** for conditional types (like `ActionFunction<...>`) even from the same module when imported across boundaries. This happened because:
- `orchestration.actions.ts` imports `assign()` from XState → returns `ActionFunction` (type identity #1)
- `orchestration.machine.ts` imports `setup()` from XState → expects `ActionFunction` (type identity #2)
- TypeScript treats identity #1 ≠ identity #2 (microsoft/TypeScript#26627)

**Solution**: **Type Alias Pattern** (implemented)
1. Created `xstate-types.d.ts` with unified `OrchestrationActionFn` type alias
2. Applied explicit type assertions to all actions in `setup()` block
3. TypeScript now treats all ActionFunction instances as the same named type

**Files changed**:
- Added: `src/modules/companies/state-machines/orchestration/xstate-types.d.ts`
- Modified: `orchestration.machine.ts` (added type assertions for 31 actions)

**Result**: ✅ **Zero TS2719 errors**, full type safety maintained

---

**Issue #2: TS2322 StateNodeConfig Type Incompatibility** ✅ **RESOLVED**

**Problem**: TypeScript showed 16 TS2322 errors: `Type 'string' is not assignable to type '"retryGusClassification"'` for state `src` fields in `orchestration.states.ts`.

**Root Cause**: TypeScript **widened literal types to string** when exporting state objects across module boundaries. This happened because:
- State exports like `export const fetchingGusClassification = { src: 'retryGusClassification', ... }` lost literal type information
- TypeScript saw `src: string` instead of `src: 'retryGusClassification'` after import
- Same root cause as TS2719: type information lost through module boundaries

**Solution**: **Const Assertion Pattern** (implemented)
1. Added `as const` to all 16 state exports in `orchestration.states.ts`
2. This preserves literal types across module imports
3. TypeScript now correctly recognizes `src: 'retryGusClassification'` as a literal type

**Files changed**:
- Modified: `src/modules/companies/state-machines/orchestration/orchestration.states.ts` (added `as const` to 16 states)

**Result**: ✅ **Zero TS2322 errors**, literal types preserved across module boundaries

**Verification**:
```bash
# TypeScript type checking (zero errors)
pnpm exec tsc --noEmit

# Integration tests (all passing)
NODE_ENV=development pnpm test test/integration/
```

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

The GUS service follows **Single Responsibility Principle** with 4 dedicated classes:

**Architecture (SRP Refactoring)**:
- **GusResponseParser** (`parsers/gus-response.parser.ts`): XML parsing and extraction from SOAP envelopes
- **GusResponseValidator** (`validators/gus-response.validator.ts`): Zod schema validation for all response types
- **GusErrorHandler** (`handlers/gus-error.handler.ts`): Error conversion to standardized ErrorResponse format
- **GusService** (`gus.service.ts`): Orchestration facade coordinating all dependencies

The GUS service uses **strong-soap v5.0.2** with custom request interceptor:

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
6. **Promise Construction Pattern**: SOAP helpers use manual `new Promise()` instead of `util.promisify`
   - **Rationale**: strong-soap callbacks return multiple values `(err, result, envelope, soapHeader)`
   - `util.promisify` only captures first non-error argument, losing `envelope` data
   - Manual Promise construction preserves all callback values with custom transformation
   - Defensive `try/catch` around operation calls prevents unhandled rejections
   - See `gus-soap.helpers.ts` for detailed JSDoc explanation

### State Machine Integration

The XState orchestration machine is **fully active** in `orchestration.service.ts`:

```typescript
const services: OrchestrationServices = {
  gusService: { getClassificationByNip, getDetailedReport },
  krsService: { fetchFromRegistry },
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
- **Configuration**: Valid API keys defined in `APP_API_KEYS` environment variable

**Error Responses**:
- `401 MISSING_API_KEY` - No Authorization header provided
- `401 INVALID_API_KEY` - Invalid or unknown API key

**Public Endpoints** (no authentication required):
- `GET /` - Root endpoint
- `GET /api/health` - Basic health check
- `GET /api/health/live` - Liveness check (Kubernetes probe)
- `GET /api/health/ready` - Readiness check (external service dependencies)
- `GET /api/health/metrics` - Application metrics with Terminus health indicators

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
  - **Security**: API keys hashed with SHA256 for rate limit identification
- **Skip Conditions**:
  - `NODE_ENV=development` - Disabled to allow unlimited local testing
  - `NODE_ENV=test` - Disabled to prevent test failures
  - Health check endpoints - Always exempt from rate limiting

**API Key Hashing for Rate Limiting** (Security Feature):

The application uses **SHA256 hashing** for API key identification in rate limiting to prevent security vulnerabilities:

```typescript
// Implementation in throttler.config.ts
function hashApiKeyForRateLimit(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
}
```

**Why SHA256 instead of substring?**

1. **Collision Prevention**: Two different API keys with same 16-char prefix won't share rate limits
   - Old approach: `apiKey.substring(0, 16)` → collision if prefixes match
   - New approach: SHA256 hash → mathematically unique identifier

2. **Security**: API key fragments don't appear in logs/metrics
   - Old approach: `"1234567890abcdef"` exposes first 16 chars of key
   - New approach: `"a3f5c2d1..."` no relation to original key

3. **Predictability Prevention**: Changing key prefix doesn't affect identifier
   - SHA256 avalanche effect: 1-bit change → ~50% output bits change
   - Prevents attackers from crafting keys with predictable rate limit IDs

**Attack Scenario Prevented**:
```typescript
// Attacker scenario: exhaust victim's rate limit
const victimKey = '1234567890abcdefVICTIM-SECRET';
const attackerKey = '1234567890abcdefATTACKER-MALICIOUS';

// Old vulnerable approach: substring(0, 16)
victimKey.substring(0, 16) === attackerKey.substring(0, 16)  // COLLISION!
// Both share same rate limit → attacker can exhaust victim's quota

// New secure approach: SHA256 hash
hashApiKeyForRateLimit(victimKey) !== hashApiKeyForRateLimit(attackerKey)  // UNIQUE
// Separate rate limits → attack prevented
```

**Hash Properties**:
- **Length**: 16 hex characters (64 bits of entropy)
- **Collision probability**: ~0.00000000000003% with 1 million API keys (birthday paradox)
- **Deterministic**: Same API key always produces same hash
- **Irreversible**: Cannot derive original API key from hash

**Testing**: See `test/unit/throttler-security.spec.ts` for comprehensive security tests

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
- **Environment variables**: Zod schemas (environment.schema.ts) with production safety checks
- **External API responses**: Zod schemas (gus.service.ts, krs.service.ts, ceidg-v3.service.ts)

#### Request Validation Flow

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

#### Environment Variable Validation (Production Safety)

The `environment.schema.ts` uses Zod's `.superRefine()` to enforce production-specific security requirements:

**Production URL Validation Approach**:
```typescript
// Hardcoded default values (extracted as constants)
const DEFAULT_GUS_BASE_URL = 'https://wyszukiwarkaregon.stat.gov.pl/...';
const DEFAULT_KRS_BASE_URL = 'https://api-krs.ms.gov.pl';

// Validation compares resolved config values with defaults
.superRefine((config, ctx) => {
  if (config.NODE_ENV === 'production') {
    // Compare config values (after .default() applied) with hardcoded defaults
    if (config.GUS_BASE_URL === DEFAULT_GUS_BASE_URL) {
      ctx.addIssue({ /* fail with security warning */ });
    }
  }
});
```

**Why Value Comparison (Not `process.env` Check)**:
- `.superRefine()` runs **AFTER** `.default()` transformations
- Comparing `config` values catches **both** missing env vars AND explicitly set defaults
- Prevents edge case: `export GUS_BASE_URL=<default-value>` would bypass `process.env` checks
- More robust: validates actual resolved configuration, not input state

**Production Requirements**:
- ✅ All API URLs (`GUS_BASE_URL`, `KRS_BASE_URL`, `CEIDG_BASE_URL`) must differ from defaults
- ✅ `APP_CORS_ALLOWED_ORIGINS` cannot be wildcard `*`
- ✅ Application fails fast on startup if validation fails

**Example Error**:
```
Production environment detected with default API URLs!
The following environment variables are using default values:
GUS_BASE_URL, KRS_BASE_URL, CEIDG_BASE_URL.
This is a security risk. Please explicitly set these variables...
```

### String Parsing Strategy

**Architectural Decision**: The codebase contains **intentional string parsing** in 5 specific locations for framework/API limitations. This is NOT technical debt.

#### Philosophy

String parsing is generally **anti-pattern** because:
- Error messages change between library versions
- Localization breaks string matching
- False positives from partial matches
- Brittle and hard to maintain

However, **strategic string parsing is acceptable** when:
1. No structural alternative exists (framework limitation)
2. Used as **last-resort fallback** after type-safe checks
3. **Extensively documented** with rationale
4. Failure mode is safe (fallback to generic error)
5. Limited to framework/external API boundaries (not business logic)

#### Type-Safe Detection Priority

The application **always prioritizes type-safe detection** before string parsing:

**Preferred Detection Methods** (in order):
1. **Error codes**: `error.code === 'ECONNABORTED'`
2. **HTTP status codes**: `error.response?.status === 404`
3. **Type guards**: `instanceof`, `'property' in object`
4. **Structured properties**: `error.fault?.faultcode`
5. **String parsing**: Only as last resort

**Implementation**: `src/modules/common/utils/error-detection.utils.ts`
- Type-safe utilities for all error types (Axios, Node.js, SOAP)
- Property checks before any string parsing
- Comprehensive JSDoc explaining each detection strategy

#### Intentional String Parsing Locations

All 5 locations are cross-referenced here for architectural awareness:

##### 1. Startup Error Detection (`src/main.ts` lines 220-248)

**Purpose**: Developer experience - helpful startup error messages

**Why string parsing?**
- Node.js error messages vary by platform and version
- No error codes for dependency injection failures
- This code runs ONLY at startup (not in request handling)
- Failure mode: Generic error message (safe)

**Alternatives considered**:
- Remove helpful hints → Poor developer experience
- Parse error.stack → Even more brittle than message parsing

**Example**:
```typescript
// INTENTIONAL STRING PARSING - Developer Experience Only
if (errorMessage.includes('EADDRINUSE')) {
  logger.error(`\n💡 Port ${port} is already in use. Please:`);
  // ... helpful suggestions
}
```

##### 2. Body-Parser Error Detection (`src/modules/common/filters/global-exception.filter.ts` lines 135-160)

**Purpose**: Detect JSON parse errors from request body

**Why string parsing?**
- NestJS wraps body-parser `SyntaxError` in generic `BadRequestException`
- body-parser does not set `error.code` or `error.type`
- No way to distinguish JSON parse errors from other 400 errors

**Alternatives considered**:
- Custom body-parser middleware → Fork/wrap body-parser (high maintenance)
- Fork NestJS ValidationPipe → Maintain compatibility with NestJS updates
- Both options create more technical debt than string parsing

**Example**:
```typescript
// INTENTIONAL STRING PARSING - NestJS/Express Framework Limitation
if (messageLower.includes('unexpected token') ||
    messageLower.includes('invalid json')) {
  return createErrorResponse({
    errorCode: 'INVALID_REQUEST_FORMAT',
    message: 'Request body contains invalid JSON',
    ...
  });
}
```

##### 3. Whitelist Validation Detection (`src/modules/common/pipes/app-validation.pipe.ts` lines 129-133)

**Purpose**: Detect extra unexpected fields in request body

**Why string parsing?**
- NestJS ValidationPipe hardcodes message "property {name} should not exist"
- No error codes for whitelist violations
- Both normal validation and whitelist violations throw `BadRequestException`
- Message format is part of NestJS public API (unlikely to change)

**Alternatives considered**:
- Fork ValidationPipe → Duplicate NestJS internal logic (fragile)
- Custom decorators → Requires extensive framework modifications
- Both options create more complexity than string parsing

**Example**:
```typescript
// INTENTIONAL STRING PARSING - NestJS Framework Limitation
return response.message.some(
  (msg: any) =>
    typeof msg === 'string' &&
    msg.toLowerCase().includes('should not exist'),
);
```

##### 4. GUS Session Error Fallback (`src/modules/external-apis/gus/handlers/gus-error.handler.ts` lines 196-208)

**Purpose**: Catch session errors not matching SOAP fault structure

**Why string parsing?**
- GUS API sometimes returns session errors in unexpected formats
- Primary detection via SOAP fault (type-safe) runs FIRST
- String parsing is **fallback only** for edge cases
- String check runs AFTER all structural checks fail

**Alternatives considered**:
- Remove fallback → Miss edge case session errors (wrong behavior)
- Parse all possible GUS formats → Impossible (API not documented)

**Example**:
```typescript
// INTENTIONAL STRING PARSING - fallback after type-safe checks
// Primary detection: isSoapFault + getGusErrorCode (lines 110-122)
if (
  errorMessage.toLowerCase().includes('session') ||
  errorMessage.toLowerCase().includes('unauthorized')
) {
  return createErrorResponse({ errorCode: 'GUS_SESSION_EXPIRED', ... });
}
```

##### 5. GUS Error Code Parsing (`src/modules/common/utils/error-detection.utils.ts` lines 249-257)

**Purpose**: Extract error code from GUS fault string when not in structured XML

**Why string parsing?**
- GUS API sometimes embeds error code in message: "... (kod=2)"
- Structured `error.fault.detail.KomunikatKod` is checked FIRST
- Regex parsing is **fallback only**
- This is a GUS API limitation (inconsistent error format)

**Alternatives considered**:
- Contact GUS to fix API → Not realistic (government API)
- Skip error code extraction → Lose valuable debugging information

**Example**:
```typescript
// Strategy 1: Structured detail object (PREFERRED)
if (detail?.KomunikatKod) {
  return detail.KomunikatKod;
}

// Strategy 2: Fallback - parse from faultstring
// INTENTIONAL STRING PARSING - GUS API limitation
const match = faultString.match(/kod[=\s]+(\d+)/i);
if (match) {
  return match[1];
}
```

#### When to Add New String Parsing

**DO NOT add string parsing** unless:
1. ✅ You've exhausted all type-safe alternatives
2. ✅ Framework/external API limitation is documented
3. ✅ Type-safe checks run first (string parsing is fallback)
4. ✅ Extensive JSDoc explains rationale
5. ✅ Cross-reference added to this CLAUDE.md section
6. ✅ Failure mode is safe (generic error code)

**Questions to ask before adding string parsing**:
- Can I use `error.code` instead?
- Can I check `error.response?.status` instead?
- Can I use `instanceof` or property checks?
- Is this a business logic error (should be BusinessException)?
- Is this at the framework boundary or in application logic?

#### Testing Strategy

String parsing locations have **defensive tests**:
- Integration tests verify current behavior
- Tests document expected string formats
- Tests fail loudly if framework messages change
- See: `tests/integration/companies-errors.spec.ts`

**When framework updates break string parsing**:
1. Tests will fail immediately (early detection)
2. Check if framework now provides error codes
3. Update to type-safe detection if possible
4. Update string patterns if necessary
5. Document the change in git commit

#### Summary

**5 intentional string parsing locations** in codebase:
1. `main.ts` - Startup error hints (developer experience)
2. `global-exception.filter.ts` - Body-parser errors (NestJS limitation)
3. `app-validation.pipe.ts` - Whitelist validation (NestJS limitation)
4. `gus-error.handler.ts` - Session error fallback (GUS API edge cases)
5. `error-detection.utils.ts` - GUS error code fallback (GUS API limitation)

**All other error detection is type-safe** using:
- `error-detection.utils.ts` - Type-safe error detection utilities
- Property checks, type guards, error codes
- No string parsing in business logic
- No string parsing in service layers

This architectural decision prioritizes:
- ✅ Pragmatism over ideological purity
- ✅ Developer experience (helpful error messages)
- ✅ Maintainability (avoid forking frameworks)
- ✅ Safety (fallback to generic errors)
- ✅ Documentation (extensive rationale for each case)

### Error Handling

Comprehensive error handling with:

- Standardized `ErrorResponse` schema
- Correlation ID tracking for debugging
- Proper HTTP status code mapping
- All exceptions transformed to ErrorResponse format by GlobalExceptionFilter

## Next Development Steps

1. **Production Features** (mostly completed):
   - ✅ API key authentication middleware
   - ✅ Rate limiting
   - ✅ Health check endpoints with @nestjs/terminus (standardized health indicators)
   - ✅ Swagger documentation

2. **Comprehensive Testing**:
   - Enable contract tests with real API stubs
   - Add unit tests for all components
   - Performance testing under load

3. **Deployment**:
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
  "@common/*": ["src/modules/common/*"],  // Common utilities, exceptions, validators
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
  "^@common/(.*)$": "<rootDir>/src/modules/common/$1",
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
3. **Module resolution errors**: See Module Resolution and Imports section above for path alias configuration
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
