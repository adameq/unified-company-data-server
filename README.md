# Unified Company Data Server

> NestJS microservice orchestrating data retrieval from Polish government APIs (GUS, KRS, CEIDG) to provide unified company information using NIP numbers.

## 🚀 Features

- **API Orchestration**: XState v5 state machines with exponential backoff retry logic
- **Real-time Integration**: Live data from GUS (SOAP), KRS (REST), CEIDG (REST)
- **Production-Ready**: API key authentication, rate limiting, health checks (@nestjs/terminus)
- **Type-Safe**: Zod validation at all boundaries, TypeScript strict mode
- **Comprehensive Testing**: 36+ integration tests covering success, error, timeout, and retry scenarios
- **Documented**: Swagger/OpenAPI integration

## 📋 Prerequisites

- Node.js 20+
- pnpm (package manager)
- GUS API key (20+ chars) - for production
- CEIDG JWT token (50+ chars) - for production

## 🔧 Quick Start

### 1. Installation

```bash
pnpm install
```

### 2. Environment Setup

Create `.env` file:

```bash
# Required
GUS_USER_KEY=your_gus_api_key_here
CEIDG_JWT_TOKEN=your_ceidg_jwt_token_here
APP_API_KEYS=dev-key-123,dev-key-456  # Comma-separated

# Optional (defaults shown)
PORT=3000
NODE_ENV=development
APP_EXTERNAL_API_TIMEOUT=5000
```

**Full environment variables list**: See [Development Guide](`.claude/development-guide.md#environment-configuration`)

### 3. Run Development Server

```bash
pnpm start:dev
# Server: http://localhost:3000
# Swagger: http://localhost:3000/api
```

### 4. Test API

```bash
curl -X POST http://localhost:3000/api/companies \
  -H "Authorization: Bearer dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{"nip": "5260250995"}'
```

## 🚀 Deployment

**Recommended Platforms:**
- Railway.app ($5/m, zero config)
- Koyeb ($3.40/m, free tier available)
- Render.com ($7/m, predictable pricing)
- Google Cloud Run (serverless, $0-2/m)

**Configuration:**
All platforms auto-detect NestJS from `package.json`. Set environment variables in platform dashboard:
- `GUS_USER_KEY`
- `CEIDG_JWT_TOKEN`
- `APP_API_KEYS`
- `APP_CORS_ALLOWED_ORIGINS` (e.g., `https://your-frontend.pages.dev`)

**Build command:** `pnpm install && pnpm build`
**Start command:** `pnpm start` (or `node dist/main.js`)

---

## 📚 API Endpoints

### Company Data

**POST /api/companies**

Retrieve unified company data by NIP.

**Request:**
```json
{
  "nip": "5260250995"
}
```

**Response (200 OK):**
```json
{
  "nip": "5260250995",
  "nazwa": "Orange Polska Spółka Akcyjna",
  "adres": {
    "wojewodztwo": "mazowieckie",
    "miejscowosc": "Warszawa",
    "kodPocztowy": "02-326",
    "ulica": "ul. Obrzeżna",
    "numerBudynku": "7"
  },
  "status": "AKTYWNY",
  "isActive": true,
  "dataRozpoczeciaDzialalnosci": "1991-12-18",
  "zrodloDanych": "GUS"
}
```

**Error Codes:**
- `INVALID_NIP_FORMAT` (400) - Invalid NIP format
- `ENTITY_NOT_FOUND` (404) - Company not found
- `RATE_LIMIT_EXCEEDED` (429) - Too many requests
- `INTERNAL_SERVER_ERROR` (500) - System fault

**Full API Reference**: [`.claude/api-reference.md`](.claude/api-reference.md)

### Health Checks

- `GET /api/health` - Basic health check
- `GET /api/health/live` - Liveness probe (Kubernetes)
- `GET /api/health/ready` - Readiness probe (checks external services)
- `GET /api/health/metrics` - Terminus health indicators (memory, process)

---

## 🧪 Testing

```bash
# All integration tests
pnpm test:integration

# Specific scenarios
pnpm test test/integration/companies-success.spec.ts
pnpm test test/integration/companies-errors.spec.ts
```

**Test Coverage**: 36+ integration tests (success, errors, timeout, retry)

**See**: [`.claude/testing-guide.md`](.claude/testing-guide.md) for detailed testing strategies.

---

## 🏗️ Project Structure

```
src/
├── main.ts                    # Application entry point
├── config/
│   └── environment.schema.ts  # Zod environment validation
├── modules/
│   ├── companies/             # Main business logic
│   │   ├── controllers/       # REST endpoints
│   │   ├── services/          # Orchestration service
│   │   └── state-machines/    # XState orchestration + retry
│   └── external-apis/         # API adapters
│       ├── gus/               # GUS SOAP service
│       ├── krs/               # KRS REST service
│       └── ceidg/             # CEIDG REST service
└── schemas/                   # Zod validation schemas
```

**Full Architecture**: [`.claude/architecture.md`](.claude/architecture.md)

---

## 📖 Documentation

- **Architecture**: [`.claude/architecture.md`](.claude/architecture.md) - State machines, retry logic, security
- **API Reference**: [`.claude/api-reference.md`](.claude/api-reference.md) - Endpoints, examples, error codes
- **Development Guide**: [`.claude/development-guide.md`](.claude/development-guide.md) - Patterns, validation, troubleshooting
- **Testing Guide**: [`.claude/testing-guide.md`](.claude/testing-guide.md) - Test strategies, fixtures

---

## 🔑 Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `GUS_USER_KEY` | GUS SOAP API key (20+ chars) | `d235b29b4a284c3d89ab` |
| `CEIDG_JWT_TOKEN` | CEIDG v3 API JWT (50+ chars) | `eyJhbGciOiJIUzI1...` |
| `APP_API_KEYS` | Comma-separated API keys (32+ chars each) | `key1,key2,key3` |

### Optional (Performance)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment (development/test/production) |
| `APP_REQUEST_TIMEOUT` | 15000 | Request timeout (ms) |
| `APP_EXTERNAL_API_TIMEOUT` | 5000 | External API timeout (ms) |
| `GUS_MAX_RETRIES` | 2 | Max retries for GUS |
| `KRS_MAX_RETRIES` | 2 | Max retries for KRS |
| `CEIDG_MAX_RETRIES` | 2 | Max retries for CEIDG |

### Optional (Security)

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated CORS origins |
| `APP_ENABLE_HELMET` | true | Enable Helmet security headers |
| `APP_RATE_LIMIT_PER_MINUTE` | 100 | Rate limit per API key |

**Full list**: [`.claude/development-guide.md#environment-configuration`](.claude/development-guide.md#environment-configuration)

---

## 🛠️ Development

### Commands

```bash
# Start development server
pnpm start:dev

# Run tests
pnpm test:integration

# TypeScript check
pnpm exec tsc --noEmit

# Build for production
pnpm build
pnpm start
```

### Code Style

- **Path Aliases**: Use `@schemas`, `@common`, `@config` for imports
- **Type Safety**: No `any` types, strict TypeScript mode
- **Error Handling**: Always use `BusinessException` for business errors
- **Configuration-Driven**: Prefer declarative configs over imperative code

**See**: [`.claude/development-guide.md`](.claude/development-guide.md) for detailed guidelines.

---

## 🔐 Security

### Authentication

All endpoints (except health checks) require API key authentication:

```bash
curl -H "Authorization: Bearer your-api-key-here" \
  http://localhost:3000/api/companies
```

### Rate Limiting

- **Production**: 100 requests/minute per API key (configurable)
- **Development/Test**: Disabled for unlimited testing

### Security Headers

Helmet.js enabled by default with:
- Content Security Policy (CSP)
- Strict Transport Security (HSTS)
- XSS Protection
- MIME Sniffing Prevention

---

## 🤝 Contributing

### Development Workflow

1. Create a feature branch
2. Make changes with tests
3. Run `pnpm exec tsc --noEmit` (type check)
4. Run `pnpm test:integration` (tests)
5. Submit pull request

### Code Guidelines

- Follow existing code style
- Write integration tests for new endpoints
- Update documentation for API changes
- Use meaningful commit messages

**See**: [`.claude/development-guide.md#code-style-and-best-practices`](.claude/development-guide.md#code-style-and-best-practices)

---

## 📊 Architecture Highlights

### State Machines (XState v5)

The application uses XState v5 for orchestration with:
- Centralized retry strategy with exponential backoff
- Per-service retry configurations (GUS, KRS, CEIDG)
- Automatic correlation ID tracking
- Type-safe state management

### Retry Architecture

| Service | Max Retries | Initial Delay | Retry Conditions |
|---------|-------------|---------------|------------------|
| **GUS** | 2 | 100ms | 5xx errors, session errors |
| **KRS** | 2 | 200ms | 5xx errors only |
| **CEIDG** | 2 | 150ms | 5xx errors only |

**Non-retryable**: 404 Not Found, 400 Bad Request, 401 Unauthorized, 429 Rate Limit

### HTTP Client

Uses **axios directly** (not `@nestjs/axios`) for:
- Per-service configuration (baseURL, headers, timeouts)
- Service-specific interceptors
- Promise pattern consistency
- Transitional timeout error detection

**Why?** See [`.claude/architecture.md#http-client-architecture`](.claude/architecture.md#http-client-architecture)

---

## 🐛 Troubleshooting

### Common Issues

1. **Environment validation fails** → Check required env vars in `.env`
2. **Tests timeout** → Ensure `NODE_ENV=development` is set
3. **Module resolution errors** → Verify path aliases in `tsconfig.json`
4. **Port already in use** → Check if another process is using port 3000

**Full troubleshooting guide**: [`.claude/development-guide.md#troubleshooting`](.claude/development-guide.md#troubleshooting)

---

## 📄 License

MIT

---

## 🔗 Links

- **Swagger API Docs**: http://localhost:3000/api (when server is running)
- **Architecture Documentation**: [`.claude/architecture.md`](.claude/architecture.md)
- **API Reference**: [`.claude/api-reference.md`](.claude/api-reference.md)
- **Development Guide**: [`.claude/development-guide.md`](.claude/development-guide.md)
- **Testing Guide**: [`.claude/testing-guide.md`](.claude/testing-guide.md)

---

## 📞 Support

For issues and questions:
1. Check documentation in `.claude/` directory
2. Review troubleshooting guide
3. Check existing GitHub issues
4. Create a new issue with:
   - Environment details (Node.js version, OS)
   - Error messages and logs
   - Steps to reproduce

---

**Built with NestJS** • **Powered by XState v5** • **Type-safe with Zod**
