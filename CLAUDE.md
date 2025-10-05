# CLAUDE.md

This file provides AI context for working with the **Unified Company Data Server** implementation.

## 📚 Knowledge Base

Detailed documentation in `.claude/` directory:

- **[Architecture](.claude/architecture.md)** - Tech stack, state machines, retry logic, HTTP client architecture, GUS SOAP implementation
- **[API Reference](.claude/api-reference.md)** - Endpoints, request/response examples, error codes, authentication, health checks
- **[Development Guide](.claude/development-guide.md)** - Module resolution, validation strategy, environment config, CORS security, string parsing philosophy
- **[Testing Guide](.claude/testing-guide.md)** - Test strategies, GUS test environment, test fixtures, coverage reports

**For users**: See [README.md](README.md) for Quick Start guide and project overview.

---

## Project Overview

**NestJS microservice** orchestrating data retrieval from Polish government APIs (GUS, KRS, CEIDG) to provide unified company information using NIP numbers.

### Current Status

- ✅ Production-ready microservice with complete external API integration
- ✅ Live API endpoint: `POST /api/companies` returning real company data
- ✅ XState v5 orchestration with exponential backoff retry logic
- ✅ 36+ integration tests covering success, error, timeout, and retry scenarios
- ✅ API key authentication, rate limiting, health checks (@nestjs/terminus)
- ✅ Type-safe error handling with correlation ID tracking

---

## Project Essentials

### Technology Stack

- **Runtime**: Node.js 18+ with TypeScript 5.0+ (strict mode enabled)
- **Framework**: NestJS with decorators and dependency injection
- **State Management**: XState v5 for orchestration workflows
- **SOAP Client**: strong-soap v5.0.2 for GUS API integration
- **HTTP Client**: axios (direct use, not @nestjs/axios wrapper)
- **Validation**: Zod schemas for all data boundaries
- **Testing**: Jest with supertest for integration tests
- **Health Checks**: @nestjs/terminus (MemoryHealthIndicator, extensible)
- **Documentation**: Swagger/OpenAPI integration

### Package Manager

**IMPORTANT: Use `pnpm` exclusively** - project configured with `.npmrc` settings specific to pnpm.

```bash
# Correct
pnpm exec tsc --noEmit
pnpm dlx typescript tsc --noEmit

# Avoid (causes npm config warnings)
npx tsc --noEmit
```

---

## Key File Locations

```text
src/
├── modules/companies/
│   ├── controllers/          # REST endpoints
│   ├── services/             # orchestration.service.ts
│   └── state-machines/       # XState orchestration + retry logic
│       ├── orchestration.machine.ts
│       ├── retry.machine.ts
│       └── retry-actor.factory.ts  # Eliminates ~180 lines duplication
├── modules/external-apis/
│   ├── gus/                  # SOAP service (SRP refactored)
│   │   ├── parsers/          # XML parsing
│   │   ├── validators/       # Zod validation
│   │   └── handlers/         # Error handling
│   ├── krs/                  # REST service
│   └── ceidg/                # REST service
└── schemas/                  # Zod validation schemas

tests/integration/            # 36+ tests (success, errors, timeout, rate-limiting)
```

---

## Development Commands

```bash
# Development server (auto-reload)
pnpm start:dev

# Production build
pnpm build && pnpm start

# Integration tests (auto-loads .env.test)
pnpm test:integration

# Type checking
pnpm exec tsc --noEmit
```

---

## Development Philosophy

1. **Type-Safe Error Detection**: Prioritize error codes, HTTP status codes, type guards over string parsing (5 intentional exceptions documented in [Development Guide](.claude/development-guide.md#string-parsing-strategy))
2. **Configuration-Driven Design**: Declarative over imperative (environment variables, retry strategies, state machines)
3. **Single Responsibility Principle**: GUS service refactored into parsers, validators, handlers, orchestration facade
4. **Fail-Fast Patterns**: Environment validation at startup, non-retryable errors (404, 400, 401, 429)
5. **Centralized Retry Logic**: XState machines with factory pattern to eliminate code duplication

---

## Important Constraints

### Authentication & Security

- **API Key Authentication**: ✅ **ALWAYS ACTIVE** in all environments (development, test, production)
- **Rate Limiting**: ✅ Active in production only (disabled in dev/test for unlimited testing)
- **CORS Security**: Wildcard `*` BLOCKED in production by Zod validation
- **Helmet.js**: HTTP security headers enabled by default (CSP, HSTS, XSS protection)

### External APIs

- **Production APIs Active**: All requests connect to real Polish government services (GUS, KRS, CEIDG)
- **GUS Test Environment**: Integration tests use 2014 database snapshot (stable, isolated from production)
- **No Mock Implementations**: All integration tests work with real data
- **Rate Limiting**: GUS API uses token bucket algorithm (10 req/s default via Bottleneck library)

### Environment Configuration

**Required Variables** (production):
- `GUS_USER_KEY` (20+ chars) - GUS SOAP API key
- `CEIDG_JWT_TOKEN` (50+ chars) - CEIDG v3 API JWT
- `APP_API_KEYS` (comma-separated, 32+ chars each) - API key authentication

**Production Safety Checks**:
- API URLs (`GUS_BASE_URL`, `KRS_BASE_URL`, `CEIDG_BASE_URL`) must differ from defaults
- CORS origins cannot be wildcard `*`
- Application fails fast on startup if validation fails

See [Development Guide](.claude/development-guide.md#environment-configuration) for full variable list.

### Code Quality

- **TypeScript Strict Mode**: No `any` types allowed
- **Path Aliases**: Use `@schemas`, `@common`, `@config` for imports (not relative paths for cross-module imports)
- **Validation Strategy**: Single layer at boundaries (class-validator DTOs, Zod schemas for env vars and external API responses)
- **Error Handling**: All exceptions transformed to standardized `ErrorResponse` format by `GlobalExceptionFilter`

---

## Module Resolution

**Path Aliases** (configured in `tsconfig.json`):
- `@/*` → `src/*`
- `@common/*` → `src/modules/common/*`
- `@config/*` → `src/config/*`
- `@schemas/*` → `src/schemas/*`
- `@modules/*` → `src/modules/*`

**Import Examples**:
```typescript
// ✅ Correct - Path aliases
import { UnifiedCompanyDataSchema } from '@schemas/unified-company-data.schema';
import { GusService } from '@modules/external-apis/gus/gus.service';
import { BusinessException } from '@common/exceptions/business-exceptions';

// ✅ OK - Relative imports for same module
import { OrchestrationService } from '../services/orchestration.service';
```

See [Development Guide](.claude/development-guide.md#module-resolution-and-imports) for details.

---

## Quick API Reference

**Main Endpoint**:
```bash
POST /api/companies
Authorization: Bearer <api-key>
Content-Type: application/json
{"nip": "5260250995"}
```

**Health Checks** (no authentication):
- `GET /api/health` - Basic health
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe (checks external services)
- `GET /api/health/metrics` - Terminus health indicators

See [API Reference](.claude/api-reference.md) for complete endpoint documentation and error codes.

---

## Known XState v5 TypeScript Fixes

**TS2719 ActionFunction Incompatibility** ✅ **RESOLVED**
- Created `xstate-types.d.ts` with unified `OrchestrationActionFn` type alias
- Applied type assertions to all actions in `orchestration.machine.ts`

**TS2322 StateNodeConfig Incompatibility** ✅ **RESOLVED**
- Added `as const` to all 16 state exports in `orchestration.states.ts`
- Preserves literal types across module boundaries

See [Architecture](.claude/architecture.md#known-xstate-v5-typescript-limitations) for detailed explanation.

---

## Next Development Steps

1. **Production Deployment**:
   - CI/CD pipeline configuration
   - Environment-specific configurations
   - Docker containerization

2. **Comprehensive Testing**:
   - Enable contract tests with real API stubs
   - Add unit tests for all components
   - Performance testing under load

3. **Monitoring & Observability**:
   - Structured logging with correlation ID
   - Metrics collection (Prometheus/Grafana)
   - Alerting for external API failures

---

## Troubleshooting

**Common Issues**:
1. **Environment validation fails** → Check `.env` for required variables
2. **Tests timeout** → Ensure `NODE_ENV=development` set for integration tests
3. **Module resolution errors** → Verify path aliases in `tsconfig.json` and restart IDE
4. **Port already in use** → Check if another process is using port 3000

**Development Server**:
```bash
source .env && pnpm start:dev  # Server: http://localhost:3000
```

See [Development Guide](.claude/development-guide.md#troubleshooting) for detailed troubleshooting.

---

**For detailed technical documentation, refer to knowledge base files in `.claude/` directory.**
