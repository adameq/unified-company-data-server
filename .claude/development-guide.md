# Development Guide

Developer guide covering development patterns, configuration, and best practices.

## Module Resolution and Imports

### Path Aliases

This project uses **path aliases** for cleaner, more maintainable imports.

**Why path aliases?**

1. **Readability**: `@schemas/unified-company-data.schema` is clearer than `'../../../schemas/unified-company-data.schema'`
2. **Refactoring**: Moving files doesn't require updating import paths
3. **Industry Standard**: Follows best practices in large TypeScript/NestJS projects
4. **No Circular Dependency Issues**: Path aliases don't cause circular dependencies - architecture does
5. **Zero Runtime Overhead**: NestJS CLI and ts-node support path aliases natively via `tsconfig-paths` (already installed)

### Path Alias Mapping

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

### Import Examples

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

### When to Use Relative vs Path Aliases

- **Path aliases**: Cross-module imports, importing from `common/`, `schemas/`, `config/`
- **Relative imports**: Same module, same directory, or immediate parent/child directories

### Jest Configuration

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

### Troubleshooting Module Resolution

If you encounter module resolution errors:

1. Verify the alias exists in `tsconfig.json` `paths` field
2. Check that `moduleNameMapper` is configured in `package.json` (for Jest)
3. Ensure `tsconfig-paths` is installed (`pnpm list tsconfig-paths`)
4. Run `pnpm exec tsc --noEmit` to check for TypeScript errors
5. Restart your IDE/language server after changing `tsconfig.json`

---

## Validation Strategy

**Philosophy**: Single responsibility - one validation layer at system boundaries

### Implementation

- **Incoming HTTP requests**: class-validator (DTO) + ValidationPipe + GlobalExceptionFilter
- **Environment variables**: Zod schemas (environment.schema.ts) with production safety checks
- **External API responses**: Zod schemas (gus.service.ts, krs.service.ts, ceidg-v3.service.ts)

### Request Validation Flow

```
HTTP Request → ValidationPipe (validates DTO)
                    ↓ (on error)
            GlobalExceptionFilter
                    ↓
            ErrorResponse format (consistent)
```

### Key Components

1. **DTO** (`company-request.dto.ts`): Defines validation rules with class-validator decorators
2. **ValidationPipe** (`main.ts`): Automatically validates all incoming requests
3. **GlobalExceptionFilter** (`common/filters/global-exception.filter.ts`): Transforms all exceptions to ErrorResponse format

### Error Code Mapping

- `INVALID_NIP_FORMAT`: NIP validation errors (format, length, type)
- `MISSING_REQUIRED_FIELDS`: Missing or empty required fields
- `INVALID_REQUEST_FORMAT`: Other validation errors or malformed requests

### Benefits

✅ Single source of truth (DTO with decorators)
✅ Consistent error format across all endpoints and error types
✅ Automatic Swagger documentation from DTO
✅ NestJS best practices and conventions
✅ No manual validation in controllers
✅ Centralized error handling for all exceptions

---

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

### Environment Variable Validation (Production Safety)

The `environment.schema.ts` uses Zod's `.superRefine()` to enforce production-specific security requirements:

**Production URL Validation**:

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

---

## CORS Security Configuration

**IMPORTANT**: CORS configuration has security implications. The application enforces safe CORS practices automatically.

### Development Setup (Recommended)

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

### Wildcard Configuration (LIMITED USE)

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

### Production Configuration (REQUIRED)

In production, wildcard `*` is **blocked by Zod validation** (`environment.schema.ts`):

```bash
# .env.production
APP_CORS_ALLOWED_ORIGINS=https://yourapp.com,https://www.yourapp.com,https://admin.yourapp.com
```

The application will **fail to start** if `APP_CORS_ALLOWED_ORIGINS=*` is set in `NODE_ENV=production`.

### Default Value

If `APP_CORS_ALLOWED_ORIGINS` is not set, the application defaults to:

```bash
http://localhost:3000,http://localhost:5173
```

This ensures safe operation out-of-the-box.

---

## String Parsing Strategy

### Philosophy

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

### Type-Safe Detection Priority

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

### Intentional String Parsing Locations

All 5 locations are cross-referenced for architectural awareness:

#### 1. Startup Error Detection (`src/main.ts`)

**Purpose**: Developer experience - helpful startup error messages

**Why string parsing?**
- Node.js error messages vary by platform and version
- No error codes for dependency injection failures
- This code runs ONLY at startup (not in request handling)
- Failure mode: Generic error message (safe)

**Example**:
```typescript
// INTENTIONAL STRING PARSING - Developer Experience Only
if (errorMessage.includes('EADDRINUSE')) {
  logger.error(`\n💡 Port ${port} is already in use. Please:`);
  // ... helpful suggestions
}
```

#### 2. Body-Parser Error Detection (`src/modules/common/filters/global-exception.filter.ts`)

**Purpose**: Detect JSON parse errors from request body

**Why string parsing?**
- NestJS wraps body-parser `SyntaxError` in generic `BadRequestException`
- body-parser does not set `error.code` or `error.type`
- No way to distinguish JSON parse errors from other 400 errors

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

#### 3. Whitelist Validation Detection (`src/modules/common/pipes/app-validation.pipe.ts`)

**Purpose**: Detect extra unexpected fields in request body

**Why string parsing?**
- NestJS ValidationPipe hardcodes message "property {name} should not exist"
- No error codes for whitelist violations
- Message format is part of NestJS public API (unlikely to change)

**Example**:
```typescript
// INTENTIONAL STRING PARSING - NestJS Framework Limitation
return response.message.some(
  (msg: any) =>
    typeof msg === 'string' &&
    msg.toLowerCase().includes('should not exist'),
);
```

#### 4. GUS Session Error Fallback (`src/modules/external-apis/gus/handlers/gus-error.handler.ts`)

**Purpose**: Catch session errors not matching SOAP fault structure

**Why string parsing?**
- GUS API sometimes returns session errors in unexpected formats
- Primary detection via SOAP fault (type-safe) runs FIRST
- String parsing is **fallback only** for edge cases

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

#### 5. GUS Error Code Parsing (`src/modules/common/utils/error-detection.utils.ts`)

**Purpose**: Extract error code from GUS fault string when not in structured XML

**Why string parsing?**
- GUS API sometimes embeds error code in message: "... (kod=2)"
- Structured `error.fault.detail.KomunikatKod` is checked FIRST
- Regex parsing is **fallback only**

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

### When to Add New String Parsing

**DO NOT add string parsing** unless:
1. ✅ You've exhausted all type-safe alternatives
2. ✅ Framework/external API limitation is documented
3. ✅ Type-safe checks run first (string parsing is fallback)
4. ✅ Extensive JSDoc explains rationale
5. ✅ Cross-reference added to this document
6. ✅ Failure mode is safe (generic error code)

**Questions to ask before adding string parsing**:
- Can I use `error.code` instead?
- Can I check `error.response?.status` instead?
- Can I use `instanceof` or property checks?
- Is this a business logic error (should be BusinessException)?
- Is this at the framework boundary or in application logic?

---

## Development Tools

### Package Manager

**Use pnpm consistently** across the project:
- Project is configured with `.npmrc` settings specific to pnpm
- Avoid mixing npm/npx commands with pnpm project setup
- When running TypeScript or other tools, use `pnpm exec` instead of `npx`

```bash
# Preferred (pnpm):
pnpm exec tsc --noEmit
pnpm dlx typescript tsc --noEmit

# Avoid (npm/npx with pnpm project):
npx tsc --noEmit  # This causes npm config warnings about unknown pnpm configs
```

**Important**: Project contains `.npmrc` with pnpm-specific configurations:
- `package-manager=pnpm` - Forces pnpm usage
- `auto-install-peers=true` - Automatically installs peer dependencies
- `strict-peer-dependencies=false` - Flexible peer dependency handling
- These configs cause npm warnings when using `npx` commands

---

## Troubleshooting

### Common Issues

1. **Environment validation fails**: Check all required environment variables in `.env`
2. **Tests timeout**: Ensure `NODE_ENV=development` is set for tests
3. **Module resolution errors**: Verify path aliases in `tsconfig.json` and restart IDE
4. **Correlation ID validation**: Changed from UUID to simple string validation
5. **Port already in use**: Check if another process is using the port (`lsof -i :3000`)
6. **pnpm config warnings**: Use `pnpm exec` instead of `npx` for TypeScript commands

### Development Server

Start the server with environment variables:

```bash
source .env && pnpm start:dev
```

The server runs on `http://localhost:3000` by default.

### TypeScript Errors

If you encounter TypeScript errors:

1. Run `pnpm exec tsc --noEmit` to see all errors
2. Check for missing type definitions (`@types/*` packages)
3. Verify path aliases are configured correctly
4. Ensure `tsconfig-paths` is installed
5. Restart your IDE's TypeScript language server

### Jest Test Errors

If tests fail with module resolution errors:

1. Check `moduleNameMapper` in `package.json`
2. Ensure all path aliases match `tsconfig.json`
3. Run tests with `NODE_ENV=development` for proper environment loading
4. Clear Jest cache: `pnpm jest --clearCache`

---

## Code Style and Best Practices

### Error Handling

Always use `BusinessException` for expected business errors:

```typescript
// ✅ Correct
throw new BusinessException({
  errorCode: 'ENTITY_NOT_FOUND',
  message: `No entity found for NIP: ${nip}`,
  correlationId,
  source: 'GUS',
});

// ❌ Avoid
throw new Error('Entity not found');
```

### Logging

Use NestJS Logger with correlation ID:

```typescript
// ✅ Correct
this.logger.log('Processing request', {
  correlationId,
  nip,
});

// ❌ Avoid
console.log('Processing request:', nip);
```

### Type Safety

Avoid `any` types - use specific types or generics:

```typescript
// ✅ Correct
function processData<T>(data: T): T {
  return data;
}

// ❌ Avoid
function processData(data: any): any {
  return data;
}
```

### Configuration-Driven Design

Prefer declarative configurations over imperative code:

```typescript
// ✅ Correct - Configuration-driven
const FIELD_CONFIG = {
  name: { field: 'nazwa', default: 'Unknown' },
  regon: { field: 'regon9', default: '' },
};

// ❌ Avoid - Repetitive methods
extractName(data) { return data.nazwa || 'Unknown'; }
extractRegon(data) { return data.regon9 || ''; }
```
