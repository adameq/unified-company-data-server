# Architecture Documentation

Detailed technical architecture of the Unified Company Data Server.

## Technology Stack

### Core Technologies

- **Runtime**: Node.js 18+ with TypeScript 5.0+
- **Framework**: NestJS with decorators and dependency injection
- **State Management**: XState v5 for orchestration workflows
- **SOAP Client**: strong-soap v5.0.2 for GUS API integration
- **HTTP Client**: axios (direct use, not @nestjs/axios wrapper)
- **Validation**: Zod schemas for all data boundaries
- **Testing**: Jest with supertest for integration tests

### Supporting Libraries

- **Logging**: NestJS built-in Logger (console output)
- **Health Checks**: @nestjs/terminus (MemoryHealthIndicator, extensible for disk/database)
- **Documentation**: Swagger/OpenAPI integration
- **Rate Limiting**: Bottleneck library with token bucket algorithm

---

## HTTP Client Architecture

### Decision: Use `axios` directly instead of `@nestjs/axios`

The project uses **per-service axios instances** with `axios.create()` for external API integrations (KRS, CEIDG). This architectural choice provides several benefits over `@nestjs/axios`.

### Why axios instead of @nestjs/axios

**1. Per-Service Configuration**
- Each external API requires different configuration (baseURL, headers, timeouts, interceptors)
- KRS and CEIDG have distinct authentication, retry policies, and error handling
- `axios.create()` provides isolated instances with full control
- `@nestjs/axios` HttpService is a global singleton - difficult to manage multiple configurations

**2. Promise Pattern Consistency**
- Entire codebase uses async/await (Promise pattern)
- `@nestjs/axios` returns RxJS Observables, requiring `firstValueFrom()` wrapper
- Direct axios keeps code simple and consistent

**3. Service-Specific Interceptors**
- **KRS**: Response interceptor for error logging
- **CEIDG**: Request interceptor (debugging) + Response interceptor (error logging)
- Each service has custom interceptor logic
- `@nestjs/axios` uses global interceptors - harder to manage service-specific logic

**4. Transitional Configuration**
- Services use `transitional.clarifyTimeoutError: true` to distinguish ETIMEDOUT vs ECONNABORTED
- Critical for `error-detection.utils.ts` timeout detection
- Easier to configure with direct axios instances

**5. Type Guards Dependency**
- `error-detection.utils.ts` uses `axios.isAxiosError()` for type guards
- Even with `@nestjs/axios`, would still need `axios` as a dependency
- Direct use eliminates unnecessary abstraction layer

### Architecture Pattern

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
    this.httpClient.interceptors.response.use(
      response => response,
      error => {
        // KRS-specific error logging
        this.logger.error('KRS API error', { error });
        throw error;
      }
    );
  }
}
```

### When @nestjs/axios makes sense

- Single global HTTP client for entire application
- RxJS Observables preferred over Promises
- Global interceptors for all requests
- Simpler use cases without per-service configuration

### Our use case

- Multiple HTTP clients with different configurations
- Promise-based async/await pattern throughout
- Service-specific interceptors and error handling
- Direct axios control for precise configuration

---

## Project Structure

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
│   │   ├── mappers/                 # Data transformation
│   │   │   └── unified-data.mapper.ts
│   │   └── state-machines/          # XState orchestration
│   │       ├── orchestration/       # Main orchestration machine
│   │       │   ├── orchestration.machine.ts
│   │       │   ├── orchestration.states.ts
│   │       │   ├── orchestration.actions.ts
│   │       │   ├── orchestration.guards.ts
│   │       │   └── orchestration.types.ts
│   │       ├── retry.machine.ts
│   │       ├── retry-actor.factory.ts  # Factory pattern (eliminates duplication)
│   │       ├── retry-strategy.interface.ts
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
│   │   │   ├── krs.service.ts
│   │   │   └── schemas/
│   │   │       └── krs-response.schema.ts
│   │   └── ceidg/                   # CEIDG REST service
│   │       ├── ceidg-v3.service.ts
│   │       └── schemas/
│   │           └── ceidg-response.schema.ts
│   └── common/                      # Shared utilities
│       ├── exceptions/              # Custom exceptions
│       ├── filters/                 # Exception filters
│       ├── guards/                  # Authentication guards
│       ├── interceptors/            # Request/response interceptors
│       ├── middleware/              # Middleware
│       ├── pipes/                   # Validation pipes
│       ├── factories/               # Exception factories
│       ├── config/                  # Configuration
│       └── utils/                   # Utility functions
└── schemas/                         # Zod validation schemas
    ├── unified-company-data.schema.ts
    ├── error-response.schema.ts
    └── orchestration-context.schema.ts

test/
├── contract/                        # External API contract tests (skipped)
├── integration/                     # Full workflow tests ✅
│   ├── companies-success.spec.ts
│   ├── companies-errors.spec.ts
│   ├── companies-timeout.spec.ts
│   └── rate-limiting.spec.ts
├── unit/                            # Component tests (skipped)
└── fixtures/                        # Test data
    └── test-nips.ts
```

---

## Retry Architecture

The application uses a **centralized retry strategy** via XState machines with a **factory pattern** to eliminate code duplication.

### Implementation Pattern

- **Service Layer** (`gus.service.ts`, `krs.service.ts`, `ceidg-v3.service.ts`): NO retry logic, methods throw errors directly
- **Orchestration Layer** (`orchestration.service.ts`): Uses `createRetryActor()` factory for all retry actors
- **Retry Actor Factory** (`retry-actor.factory.ts`): Generic factory function that eliminates ~180 lines of duplication
- **Retry Machine** (`retry.machine.ts`): Generic, reusable state machine for exponential backoff

### Configuration per Service

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

### Exponential Backoff

- **Formula**: `delay = initialDelay * 2^attempt + jitter`
- **Jitter**: ±10% symmetric random variation (prevents thundering herd)
- **Implementation**: `(Math.random() - 0.5) * 0.2 * exponentialDelay`
- **Max delay**: 5000ms
- **Managed automatically** by `retry.machine.ts`

### Special Cases

- **GUS Session Recovery**: On session errors, new session is created before retry
- **KRS Registry Fallback**: P→S registry fallback is NOT part of retry logic (separate business logic)
- **Correlation ID**: Tracked through all retry attempts for debugging

### XState v5 Pattern

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
}
```

**Key XState v5 Features**:
- `fromPromise` wraps async actor creation
- `createActor` + dynamic input for each API call
- `subscribe({ complete })` callback for final state detection
- `snapshot.output` + `snapshot.context.result` fallback for data retrieval
- Proper error propagation via `reject()`

### Retry Actor Factory Pattern

**Problem**: Previously, `orchestration.service.ts` had 4 nearly identical retry actors with ~42 lines each (~180 lines total duplication).

**Solution**: Generic `createRetryActor()` factory function:

```typescript
// Before (42 lines per actor × 4 actors = ~180 lines):
retryGusClassification: fromPromise(async ({ input }) => {
  const { nip, correlationId } = input;
  const retryMachine = createRetryMachine(...);
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

---

## State Machine Integration

The XState orchestration machine is **fully active** in `orchestration.service.ts`:

```typescript
const services: OrchestrationServices = {
  gusService: { getClassificationByNip, getDetailedReport },
  krsService: { fetchFromRegistry },
  ceidgService: { getCompanyByNip },
};
const orchestrationMachine = createOrchestrationMachine(services);
```

### Orchestration Workflow

1. **Input validation**: NIP format validation
2. **GUS classification**: Determine entity type and routing
3. **Detailed data retrieval**: Get comprehensive data from GUS
4. **Specialized lookups**: KRS for legal entities, CEIDG for entrepreneurs
5. **Data mapping**: Unify all sources into standardized format

### Known XState v5 TypeScript Limitations

#### Issue #1: TS2719 ActionFunction Type Incompatibility ✅ **RESOLVED**

**Problem**: TypeScript showed 23 TS2719 errors: "Two different types with this name exist, but they are unrelated"

**Root Cause**: TypeScript creates distinct type identities for conditional types when imported across boundaries

**Solution**: Type Alias Pattern
1. Created `xstate-types.d.ts` with unified `OrchestrationActionFn` type alias
2. Applied explicit type assertions to all actions in `setup()` block
3. TypeScript now treats all ActionFunction instances as the same named type

**Result**: ✅ **Zero TS2719 errors**, full type safety maintained

#### Issue #2: TS2322 StateNodeConfig Type Incompatibility ✅ **RESOLVED**

**Problem**: TypeScript showed 16 TS2322 errors: widened literal types to string

**Root Cause**: State exports lost literal type information across module boundaries

**Solution**: Const Assertion Pattern
1. Added `as const` to all 16 state exports in `orchestration.states.ts`
2. Preserves literal types across module imports

**Result**: ✅ **Zero TS2322 errors**, literal types preserved

---

## Production API Integration

### GUS (Polish Statistical Office)

**Primary data source** via SOAP API using strong-soap client.

**Technical Details**:
- **SOAP 1.2** protocol with MTOM responses
- **WS-Addressing headers** required: `<wsa:To>` and `<wsa:Action>`
- **Session management**: 60-minute sessions with `sid` HTTP header
- **Rate limiting**: Bottleneck library with token bucket algorithm (10 req/s default)
- **Namespace handling**: `xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract"` at Envelope level

**Architecture (SRP Refactoring)**:
- **GusResponseParser** (`parsers/gus-response.parser.ts`): XML parsing and extraction from SOAP envelopes
- **GusResponseValidator** (`validators/gus-response.validator.ts`): Zod schema validation for all response types
- **GusErrorHandler** (`handlers/gus-error.handler.ts`): Error conversion to standardized ErrorResponse format
- **GusService** (`gus.service.ts`): Orchestration facade coordinating all dependencies

**Key Implementation Details**:

1. **WS-Addressing Headers**: Custom interceptor injects required SOAP headers without `soap:mustUnderstand` attributes
2. **DataContract Namespace**: Added at Envelope level to avoid inline namespace declarations
3. **Rate Limiting**: Global rate limiter using Bottleneck (token bucket)
   - Configuration: `GUS_MAX_REQUESTS_PER_SECOND` environment variable (default: 10 req/s)
   - Queues all concurrent requests, executes serially with rate control
4. **Session Management**: HTTP header `sid` (not SOAP header) with automatic re-addition
5. **MTOM Response Handling**: strong-soap automatically parses MTOM responses
6. **Promise Construction Pattern**: Manual `new Promise()` instead of `util.promisify`
   - Rationale: strong-soap callbacks return multiple values `(err, result, envelope, soapHeader)`
   - `util.promisify` only captures first non-error argument
   - Manual construction preserves all callback values

### KRS (National Court Register)

**Legal entities data** via REST API.

**Technical Details**:
- **Protocol**: REST API with JSON responses
- **Authentication**: Public API, no authentication required
- **Base URL**: `https://api-krs.ms.gov.pl`
- **Timeout**: Configured via `APP_EXTERNAL_API_TIMEOUT` (default: 5000ms)
- **Registries**: P (primary) and S (secondary) with automatic fallback

**Implementation**:
- Per-service axios instance with response interceptor
- Automatic P→S registry fallback (separate from retry logic)
- Error standardization via BusinessException

### CEIDG (Central Registration of Business Activity)

**Individual entrepreneurs** via REST API.

**Technical Details**:
- **Protocol**: REST API v3 with JSON responses
- **Authentication**: JWT token via `CEIDG_JWT_TOKEN` environment variable
- **Base URL**: Configured via `CEIDG_BASE_URL`
- **Timeout**: Configured via `APP_EXTERNAL_API_TIMEOUT` (default: 5000ms)

**Implementation**:
- Per-service axios instance with request/response interceptors
- JWT authentication via Authorization header
- Status mapping: CEIDG statuses → unified status enum

---

## Security Architecture

### HTTP Security Headers (Helmet.js)

**Status**: ✅ **ACTIVE** by default (configurable via `ENABLE_HELMET` env var)

**Configuration**: Restrictive Content Security Policy (CSP) + comprehensive security headers

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

### API Key Authentication

**Implementation**: `ApiKeyGuard` in `src/modules/common/guards/api-key.guard.ts`

- **Status**: ✅ **ACTIVE** in all environments (development, test, production)
- **Requirement**: All endpoints require `Authorization: Bearer <api-key>` header
- **Exceptions**: Endpoints marked with `@Public()` decorator (health checks)
- **Configuration**: Valid API keys defined in `APP_API_KEYS` environment variable

**Public Endpoints** (no authentication required):
- `GET /` - Root endpoint
- `GET /api/health` - Basic health check
- `GET /api/health/live` - Liveness check
- `GET /api/health/ready` - Readiness check
- `GET /api/health/metrics` - Application metrics

### Rate Limiting

**Implementation**: `CustomThrottlerGuard` in `src/modules/common/config/throttler.config.ts`

- **Status**: ✅ **ACTIVE** in production, ⚠️ **DISABLED** in development/test
- **Configuration**:
  - Default: 100 requests per minute per API key
  - Burst protection: 10 requests per 10 seconds
  - Per-API-key tracking (isolated limits)
  - **Security**: API keys hashed with SHA256 for rate limit identification

**API Key Hashing** (Security Feature):

```typescript
function hashApiKeyForRateLimit(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
}
```

**Why SHA256 instead of substring?**
1. **Collision Prevention**: Different API keys with same 16-char prefix won't share rate limits
2. **Security**: API key fragments don't appear in logs/metrics
3. **Predictability Prevention**: Changing key prefix doesn't affect identifier

**Why Disabled in Development/Test**:
- **Development**: Developers need unlimited requests for debugging
- **Integration Tests**: Tests make many rapid requests without artificial limits
- **Production**: Rate limiting protects against abuse

---

## Development Philosophy

### 1. Type-Safe Error Detection

Prioritize error codes and property checks over string parsing.

**Preferred Detection Methods** (in order):
1. **Error codes**: `error.code === 'ECONNABORTED'`
2. **HTTP status codes**: `error.response?.status === 404`
3. **Type guards**: `instanceof`, `'property' in object`
4. **Structured properties**: `error.fault?.faultcode`
5. **String parsing**: Only as last resort (5 intentional locations)

### 2. Configuration-Driven Design

Declarative configs over imperative code.

**Examples**:
- `GUS_FIELD_CONFIG` map instead of 12 `extractGus...()` methods
- `CEIDG_STATUS_MAP` instead of switch statement
- `KRS_LEGAL_FORM_PATTERNS` regex array instead of if/includes chains

### 3. Single Responsibility Principle

Each class has one job.

**Examples**:
- GUS service split: Parser, Validator, ErrorHandler, Service (orchestrator)
- Retry logic delegated to RetryStrategy instances (Open/Closed Principle)
- Mapper uses configuration instead of repetitive methods

### 4. Fail-Fast Patterns

Prevent cascading failures.

**Examples**:
- Exponential backoff cooldowns in `GusSessionManager`
- Non-retryable errors (404, 400, 401, 429) fail immediately
- Correlation ID tracking through all retry attempts
