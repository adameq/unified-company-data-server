# API Reference

Complete API documentation for all endpoints.

## Company Data Endpoints

### POST /api/companies

Retrieve unified company data by NIP number.

**Authentication**: Required (API key via `Authorization: Bearer <key>`)

**Request:**

```http
POST /api/companies HTTP/1.1
Host: localhost:3000
Authorization: Bearer your-api-key-here
Content-Type: application/json

{
  "nip": "5260250995"
}
```

**Request Body Schema:**

```typescript
{
  nip: string;  // Exactly 10 digits, validated by class-validator
}
```

**Response (200 OK):**

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
  "dataZakonczeniaDzialalnosci": null,
  "regon": "012100784",
  "formaPrawna": "SPÓŁKA AKCYJNA",
  "typPodmiotu": "PRAWNA",
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

**Response Schema:**

See `src/schemas/unified-company-data.schema.ts` for complete Zod schema.

**Key Fields:**
- `nip`: NIP number (10 digits)
- `nazwa`: Company name
- `adres`: Full address object
- `status`: Company status (AKTYWNY, NIEAKTYWNY, ZAWIESZONY, WYREJESTROWANY, W LIKWIDACJI, UPADŁOŚĆ)
- `isActive`: Boolean flag derived from status
- `dataRozpoczeciaDzialalnosci`: Business start date (YYYY-MM-DD)
- `dataZakonczeniaDzialalnosci`: Business end date (optional)
- `regon`: REGON number
- `formaPrawna`: Legal form (SPÓŁKA Z O.O., SPÓŁKA AKCYJNA, etc.)
- `typPodmiotu`: Entity type (PRAWNA, FIZYCZNA)
- `pkd`: Array of PKD codes (Polish business classification)
- `zrodloDanych`: Data source (GUS, KRS, CEIDG)
- `dataAktualizacji`: Last update timestamp (ISO 8601)

---

## Error Responses

All errors follow standardized `ErrorResponse` schema.

### Error Response Format

```json
{
  "errorCode": "ERROR_CODE",
  "message": "Human-readable error message",
  "correlationId": "req-1758914092756-j57tbg1gn",
  "source": "INTERNAL" | "GUS" | "KRS" | "CEIDG",
  "timestamp": "2025-09-26T20:14:52.756Z",
  "details": {
    // Optional additional context
  }
}
```

### Error Codes

#### Input Validation Errors (400 Bad Request)

**INVALID_NIP_FORMAT**
```json
{
  "errorCode": "INVALID_NIP_FORMAT",
  "message": "Invalid NIP format: 123. Expected 10 digits.",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**MISSING_REQUIRED_FIELDS**
```json
{
  "errorCode": "MISSING_REQUIRED_FIELDS",
  "message": "Missing required field: nip",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**INVALID_REQUEST_FORMAT**
```json
{
  "errorCode": "INVALID_REQUEST_FORMAT",
  "message": "Request body contains invalid JSON",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

#### Authentication Errors (401 Unauthorized)

**MISSING_API_KEY**
```json
{
  "errorCode": "MISSING_API_KEY",
  "message": "Missing API key. Please provide a valid API key in the Authorization header.",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**INVALID_API_KEY**
```json
{
  "errorCode": "INVALID_API_KEY",
  "message": "Invalid API key. The provided API key is not recognized.",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

#### Business Logic Errors (404 Not Found)

**ENTITY_NOT_FOUND**
```json
{
  "errorCode": "ENTITY_NOT_FOUND",
  "message": "No entity found for identifier: 0000000000",
  "correlationId": "req-...",
  "source": "GUS",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**ENTITY_DEREGISTERED**
```json
{
  "errorCode": "ENTITY_DEREGISTERED",
  "message": "Entity is deregistered",
  "correlationId": "req-...",
  "source": "GUS",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

#### Rate Limiting Errors (429 Too Many Requests)

**RATE_LIMIT_EXCEEDED**
```json
{
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "message": "API rate limit exceeded. Please reduce request frequency and try again.",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z",
  "details": {
    "retryAfter": "60"
  }
}
```

#### System Errors (500 Internal Server Error)

**INTERNAL_SERVER_ERROR**
```json
{
  "errorCode": "INTERNAL_SERVER_ERROR",
  "message": "System fault occurred",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**TIMEOUT_ERROR**
```json
{
  "errorCode": "TIMEOUT_ERROR",
  "message": "Company data retrieval timed out",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**DATA_MAPPING_FAILED**
```json
{
  "errorCode": "DATA_MAPPING_FAILED",
  "message": "Data mapping failed",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z"
}
```

**GUS_SERVICE_UNAVAILABLE**
```json
{
  "errorCode": "GUS_SERVICE_UNAVAILABLE",
  "message": "GUS session creation in cooldown period. Please retry after 5000ms.",
  "correlationId": "req-...",
  "source": "GUS",
  "timestamp": "2025-09-26T20:14:52.756Z",
  "details": {
    "consecutiveFailures": 3,
    "cooldownRemaining": 5000
  }
}
```

#### Service Degradation Errors (503 Service Unavailable)

**SERVICE_DEGRADED**
```json
{
  "errorCode": "SERVICE_DEGRADED",
  "message": "One or more external services are unavailable",
  "correlationId": "req-...",
  "source": "INTERNAL",
  "timestamp": "2025-09-26T20:14:52.756Z",
  "details": {
    "services": {
      "gus": "unhealthy",
      "krs": "healthy",
      "ceidg": "healthy"
    }
  }
}
```

---

## Health Check Endpoints

Health endpoints use **@nestjs/terminus** for standardized health indicators.

### GET /api/health

Basic health check without external dependencies.

**Authentication**: Not required (public endpoint)

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2025-10-04T15:10:00.000Z",
  "uptime": 3600,
  "version": "0.0.1",
  "environment": "development"
}
```

### GET /api/health/live

Liveness probe for Kubernetes/container orchestration.

**Authentication**: Not required (public endpoint)

**Purpose**: Indicates if the application is running (simple check, no dependencies)

**Response (200 OK):**

```json
{
  "status": "ok",
  "timestamp": "2025-10-04T15:10:00.000Z"
}
```

### GET /api/health/ready

Readiness check including external service health (GUS, KRS, CEIDG).

**Authentication**: Not required (public endpoint)

**Purpose**: Indicates if the application is ready to serve traffic (checks external dependencies)

**Response (200 OK - healthy):**

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

**Response (503 SERVICE_DEGRADED - degraded):**

```json
{
  "errorCode": "SERVICE_DEGRADED",
  "message": "One or more external services are unavailable",
  "correlationId": "health-1696512000000",
  "source": "INTERNAL",
  "timestamp": "2025-10-04T15:10:00.000Z",
  "details": {
    "services": {
      "gus": "unhealthy",
      "krs": "healthy",
      "ceidg": "healthy"
    },
    "dependencies": {
      "gus": "unhealthy",
      "krs": "healthy",
      "ceidg": "healthy"
    }
  }
}
```

**Note**: Error response follows global error handling strategy via `GlobalExceptionFilter`. Controller throws `BusinessException` with `SERVICE_DEGRADED` error code.

### GET /api/health/metrics

Application metrics using Terminus health indicators.

**Authentication**: Not required (public endpoint)

**Features**:
- **MemoryHealthIndicator**: Heap and RSS memory monitoring
- **Extensible**: Easy to add DiskHealthIndicator, DatabaseHealthIndicator, etc.
- **Standardized format**: Industry-standard health check response

**Response (200 OK):**

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

**Thresholds**:
- Heap memory: 512 MB (typical Node.js application)
- RSS memory: 1 GB (total process memory)

**Future Extensions**:

```typescript
// Easy to add more health indicators:
await this.health.check([
  () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
  () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
  () => this.disk.checkStorage('disk', { path: '/', threshold: 0.9 }), // Disk usage
  () => this.database.pingCheck('database', { timeout: 1000 }), // Database health
]);
```

---

## Authentication

### API Key Authentication

All endpoints (except health checks) require API key authentication.

**Header Format**:

```
Authorization: Bearer <api-key>
```

**Example Request**:

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Authorization: Bearer your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"nip": "5260250995"}'
```

**Configuration**:

API keys are configured via `APP_API_KEYS` environment variable (comma-separated list):

```bash
APP_API_KEYS=dev-key-123,dev-key-456,prod-key-789
```

**Public Endpoints** (no authentication required):
- `GET /` - Root endpoint
- `GET /api/health` - Basic health check
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe
- `GET /api/health/metrics` - Application metrics

---

## Swagger/OpenAPI Documentation

Interactive API documentation is available via Swagger UI.

**URL**: `http://localhost:3000/api`

**Features**:
- Complete API schema with request/response examples
- Try-it-out functionality for all endpoints
- Authentication support (API key input)
- Auto-generated from NestJS decorators and DTOs

**Configuration**:

Swagger is controlled via environment variables:

```bash
APP_SWAGGER_ENABLED=true
APP_SWAGGER_SERVER_URL_DEVELOPMENT=http://localhost:3000
APP_SWAGGER_SERVER_URL_PRODUCTION=https://api.example.com
```

---

## cURL Examples

### Successful Company Lookup

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "nip": "5260250995"
  }'
```

### Company Not Found (404)

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "nip": "0000000000"
  }'
```

### Invalid NIP Format (400)

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "nip": "123"
  }'
```

### Missing API Key (401)

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Content-Type: application/json" \
  -d '{
    "nip": "5260250995"
  }'
```

### Health Check (No Auth)

```bash
# Basic health
curl http://localhost:3000/api/health

# Liveness probe
curl http://localhost:3000/api/health/live

# Readiness probe
curl http://localhost:3000/api/health/ready

# Metrics
curl http://localhost:3000/api/health/metrics
```

---

## HTTP Status Codes

| Status Code | Meaning | Example Error Code |
|-------------|---------|-------------------|
| 200 | OK | Success response |
| 400 | Bad Request | INVALID_NIP_FORMAT, MISSING_REQUIRED_FIELDS |
| 401 | Unauthorized | MISSING_API_KEY, INVALID_API_KEY |
| 404 | Not Found | ENTITY_NOT_FOUND, ENTITY_DEREGISTERED |
| 429 | Too Many Requests | RATE_LIMIT_EXCEEDED |
| 500 | Internal Server Error | INTERNAL_SERVER_ERROR, TIMEOUT_ERROR |
| 503 | Service Unavailable | SERVICE_DEGRADED |

---

## Correlation ID

All requests and responses include a `correlationId` for tracking and debugging.

**Request Header** (optional):

```
X-Correlation-ID: custom-correlation-id
```

**If not provided**, a correlation ID is automatically generated:

Format: `req-<timestamp>-<random-string>`

Example: `req-1758914092756-j57tbg1gn`

**Response** (always included):

```json
{
  "correlationId": "req-1758914092756-j57tbg1gn",
  ...
}
```

**Logs** (correlation ID tracked through entire request lifecycle):

```
[CorrelationIdInterceptor] Request received { correlationId: 'req-...', method: 'POST', path: '/api/companies' }
[OrchestrationService] Starting orchestration { correlationId: 'req-...' }
[GusService] Fetching classification { correlationId: 'req-...' }
[CorrelationIdInterceptor] Request completed { correlationId: 'req-...', statusCode: 200, duration: 1234 }
```
