# CI/CD Deployment Guide - Backend API

Automated deployment using GitHub Actions + GHCR + Watchtower.

## Quick Start

**Full documentation:** See [frontend DEPLOYMENT_CI_CD.md](../thespace-react-form/DEPLOYMENT_CI_CD.md) for detailed workflow explanation.

This document covers **API-specific** configuration and deployment.

---

## Architecture

```
git push → GitHub Actions → Build + Push to GHCR → SSH Deploy → Hetzner Server
                                                                     ↓
                                              Watchtower (backup monitor every 5min)
                                                                     ↓
                                        Docker Compose (API + Caddy + Watchtower)
```

---

## Trigger Events

Workflow runs on push to `main` with changes to:
- `src/**` - Source code
- `package.json` - Dependencies
- `Dockerfile` - Docker configuration
- `docker-compose.yml` - Compose configuration
- `tsconfig.json` / `nest-cli.json` - TypeScript/NestJS config
- `.github/workflows/deploy.yml` - Workflow itself

Manual trigger: **Actions** → **Build and Deploy API** → **Run workflow**

---

## Deployment Steps

### 1. Build Phase (~3-5 minutes)
- Checkout code
- Build Docker image (multi-stage: builder + production)
- Tag: `latest` + `sha-xxxxxxx`
- Push to `ghcr.io/adameq/thespace-api`

### 2. Deploy Phase (~2-3 minutes)
- SSH to Hetzner server
- Generate `.env` from GitHub Secrets (auto-generated)
- `docker-compose pull` - Pull new image
- `docker-compose up -d` - Restart with zero downtime
- Health check verification

### 3. Health Check Verification
- Workflow waits for `/api/health` endpoint (30 retries × 2s)
- Logs shown if health check fails
- Deploy marked successful only if healthy

**Total time:** ~5-8 minutes

---

## Environment Variables (Auto-Generated)

GitHub Actions automatically generates `.env` from secrets:

```bash
# Generated from GitHub Secrets:
NODE_ENV=production
PORT=3000
GUS_USER_KEY=${GUS_USER_KEY}
CEIDG_JWT_TOKEN=${CEIDG_JWT_TOKEN}
APP_API_KEYS=${APP_API_KEYS}
CORS_ORIGINS=${CORS_ORIGINS}
# ... and more (see .env.example)
```

**Source of Truth:** GitHub Secrets → Fresh `.env` on every deploy

---

## Zero-Downtime Deployment

### How It Works

1. **New container starts** with new image
2. **Health checks** wait for API to be ready (10s start period)
3. **Caddy switches traffic** when new container is healthy
4. **Old container stops** (`--remove-orphans`)

### Health Check Configuration

```yaml
healthcheck:
  test: wget http://localhost:3000/api/health
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

---

## Watchtower Configuration

**Backup monitoring** (if GitHub Actions fails):
- Checks GHCR every 5 minutes
- Pulls new images automatically
- Rolling restart (zero downtime)

```bash
# View Watchtower logs
docker logs -f thespace-api-watchtower

# Force manual check
docker exec thespace-api-watchtower watchtower --run-once
```

---

## Monitoring

### GitHub Actions Logs
Repository → Actions → Build and Deploy API → Select run

### Server Logs
```bash
# All logs
docker-compose logs -f

# API only
docker logs -f thespace-api

# Caddy only
docker logs -f thespace-api-caddy

# Watchtower
docker logs -f thespace-api-watchtower
```

### Health Checks
```bash
# Local health check
curl http://localhost:3001/api/health

# Detailed metrics
curl http://localhost:3001/api/health/metrics

# Liveness/Readiness probes
curl http://localhost:3001/api/health/live
curl http://localhost:3001/api/health/ready
```

---

## Troubleshooting

### Build Fails

**Common causes:**
- TypeScript errors
- ESLint errors
- Missing dependencies

**Solution:**
```bash
# Test locally first
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

### GUS/CEIDG API Errors After Deploy

**Symptom:** `SOAP authentication failed` or `Invalid JWT token`

**Check:**
```bash
# View API logs
docker logs thespace-api | grep -i error

# Check .env variables
docker exec thespace-api env | grep -E 'GUS|CEIDG'
```

**Solution:**
1. Verify secrets in GitHub Secrets
2. Regenerate expired tokens
3. Push to trigger redeploy with new secrets

### Health Check Fails

**Symptom:** Workflow shows "Health check timeout"

**Check:**
```bash
# SSH to server
ssh user@server

# Check API logs
docker logs --tail=100 thespace-api

# Test health endpoint directly
docker exec thespace-api wget -qO- http://localhost:3000/api/health
```

**Common causes:**
- Environment validation failed (missing required vars)
- External API connectivity issues
- Port 3000 already in use
- Database/cache connection issues (if applicable)

### CORS Errors

**Symptom:** Frontend can't connect to API

**Check:**
```bash
# View CORS_ORIGINS
docker exec thespace-api env | grep CORS_ORIGINS
```

**Solution:**
1. Update `CORS_ORIGINS` in GitHub Secrets
2. Include protocol and exact domain: `https://yourdomain.com`
3. Push to redeploy

---

## Deployment Scenarios

### Standard Deployment
```bash
git add src/modules/companies/controllers/companies.controller.ts
git commit -m "feat: Add company search endpoint"
git push origin main
# → Automatic deployment in ~5-8 minutes
```

### Update Secrets (API Keys Rotation)
```bash
# Update in GitHub Secrets UI or CLI:
gh secret set GUS_USER_KEY --body "new-key"

# Trigger redeploy:
git commit --allow-empty -m "chore: Rotate GUS API key"
git push origin main
# → New .env generated with updated secrets
```

### Emergency Rollback
```bash
# Option 1: Revert commit
git revert HEAD
git push origin main

# Option 2: Manual rollback on server
ssh user@server
cd /opt/thespace-api
docker pull ghcr.io/adameq/thespace-api:sha-abc1234
# Edit docker-compose.yml to use specific SHA
docker-compose up -d
```

---

## Performance Optimization

| Phase | Time | Notes |
|-------|------|-------|
| Build | 3-5min | Cache enabled, Alpine base |
| Push to GHCR | 30s-1min | Layer deduplication |
| Pull on server | 30s-1min | Only changed layers |
| Container restart | 10-20s | Health checks + rolling |
| **Total** | **5-8min** | Full pipeline |

**Image size:** ~200-300MB (Alpine + NestJS + dependencies)

---

## Security

- ✅ Secrets in GitHub Secrets (encrypted, masked in logs)
- ✅ `.env` auto-generated (never committed)
- ✅ Non-root user in container
- ✅ API key authentication enforced
- ✅ Rate limiting enabled (production)
- ✅ Helmet.js security headers

---

## API-Specific Monitoring

### External API Health

```bash
# Check if external APIs are reachable
curl http://localhost:3001/api/health/ready

# View metrics (memory, uptime)
curl http://localhost:3001/api/health/metrics
```

### Rate Limiting Stats

```bash
# Check API logs for rate limit hits
docker logs thespace-api | grep -i "throttler"

# 429 errors indicate rate limit exceeded
docker logs thespace-api | grep " 429 "
```

### SOAP/REST API Errors

```bash
# GUS API errors
docker logs thespace-api | grep -i "GUS"

# CEIDG API errors
docker logs thespace-api | grep -i "CEIDG"

# KRS API errors
docker logs thespace-api | grep -i "KRS"
```

---

## Best Practices

1. **Test external APIs before deploy:**
   ```bash
   # Test GUS connection locally
   pnpm start:dev
   curl -X POST http://localhost:3000/api/companies \
     -H "Authorization: Bearer your-api-key" \
     -H "Content-Type: application/json" \
     -d '{"nip": "5260250995"}'
   ```

2. **Monitor first deployment closely:**
   - Watch GitHub Actions logs
   - Check server logs after deploy
   - Test all API endpoints
   - Verify external API integrations work

3. **Keep API keys secure:**
   - Never commit to Git
   - Rotate periodically (6 months)
   - Use separate keys for dev/prod

4. **Plan maintenance windows:**
   - Deploy during low-traffic periods
   - Test on staging first (if available)
   - Have rollback plan ready

---

## Additional Resources

- [SETUP_GITHUB_SECRETS.md](./SETUP_GITHUB_SECRETS.md) - Secret configuration
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Manual deployment guide
- [.claude/api-reference.md](.claude/api-reference.md) - API endpoints
- [.claude/architecture.md](.claude/architecture.md) - Technical architecture
- [Frontend CI/CD Guide](../thespace-react-form/DEPLOYMENT_CI_CD.md) - Detailed workflow explanation
