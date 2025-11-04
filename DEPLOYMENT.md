# Deployment Guide - Unified Company Data Server (API)

## Docker Deployment with Caddy Reverse Proxy

This guide covers deployment of the NestJS API application using Docker and Caddy as a reverse proxy.

## Prerequisites

- Docker (version 20.10+)
- Docker Compose (version 2.0+)
- Port 3001 and 3443 available on host machine
- `.env` file with required environment variables

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ HTTP/HTTPS
       ▼
┌─────────────┐
│    Caddy    │ (Reverse Proxy)
│ :3001/:3443 │
└──────┬──────┘
       │
       │ Internal Network
       ▼
┌─────────────┐
│   NestJS    │ (API Server)
│    :3000    │
└─────────────┘
```

## Configuration Files

### 1. Dockerfile
Multi-stage build optimized for production:
- **Builder stage**: Installs dependencies and builds NestJS app
- **Production stage**: Runs built application with production dependencies
- **Security**: Non-root user execution
- **Health checks**: Monitors API availability

### 2. docker-compose.yml
Orchestrates two services:
- `api`: NestJS application container
- `caddy`: Reverse proxy with health check support

### 3. Caddyfile
Caddy configuration with:
- Reverse proxy to NestJS container
- Active health checks
- Gzip compression
- CORS headers (configurable)
- Security headers

## Environment Configuration

### Required Environment Variables

Create `.env` file in the root directory (see CLAUDE.md for full list):

```bash
# GUS API
GUS_USER_KEY=your-gus-api-key-here
GUS_BASE_URL=https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc

# CEIDG API
CEIDG_JWT_TOKEN=your-ceidg-jwt-token-here
CEIDG_BASE_URL=https://dane.biznes.gov.pl/api/ceidg/v2

# KRS API
KRS_BASE_URL=https://api-krs.ms.gov.pl

# Application
NODE_ENV=production
PORT=3000
APP_API_KEYS=your-32-char-api-key-here,another-api-key-here

# CORS
CORS_ORIGINS=https://your-frontend-domain.com

# Rate Limiting
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# Timeouts
REQUEST_TIMEOUT=30000
GUS_RATE_LIMIT_PER_SECOND=10
```

**IMPORTANT**: Never commit `.env` to version control!

## Deployment Steps

### 1. Prepare Environment

```bash
cd unified-company-data-server

# Create .env file with production values
cp .env.example .env
nano .env  # Edit with your credentials
```

### 2. Build and Start Services

```bash
# Build and start containers in detached mode
docker-compose up -d --build
```

### 3. Verify Deployment

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f

# Check API health
curl http://localhost:3001/api/health

# Test API endpoint (replace with your API key)
curl -X POST http://localhost:3001/api/companies \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"nip": "5260250995"}'
```

### 4. Access Application

- **HTTP**: http://your-domain.com:3001 or http://localhost:3001
- **HTTPS**: https://your-domain.com:3443 (if domain configured)
- **Health Check**: http://localhost:3001/api/health
- **API Docs**: http://localhost:3001/api/docs (if Swagger enabled)

## Production Configuration

For production deployment with custom domain and HTTPS:

### Update Caddyfile

Replace `:80` with your domain:

```caddyfile
api.your-domain.com {
    reverse_proxy api:3000 {
        health_uri /api/health
        health_interval 30s
        health_timeout 5s
    }

    # ... rest of configuration
}
```

### Update CORS Origins

In `.env`, set allowed origins:

```bash
CORS_ORIGINS=https://your-frontend-domain.com,https://another-domain.com
```

### Security Hardening

In `Caddyfile`, adjust CORS headers:

```caddyfile
header {
    -Server
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    X-XSS-Protection "1; mode=block"

    # Replace wildcard with specific origin
    Access-Control-Allow-Origin "https://your-frontend-domain.com"
    Access-Control-Allow-Methods "GET, POST, OPTIONS"
    Access-Control-Allow-Headers "Content-Type, Authorization"
}
```

## Management Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### Restart Services
```bash
docker-compose restart
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f caddy

# Last 100 lines
docker-compose logs --tail=100 api
```

### Rebuild After Changes
```bash
docker-compose up -d --build
```

### Update Environment Variables
```bash
# Edit .env file
nano .env

# Restart to apply changes
docker-compose restart api
```

### Execute Commands in Container
```bash
# Shell access
docker-compose exec api sh

# Run pnpm commands
docker-compose exec api pnpm exec tsc --noEmit
```

## Port Configuration

Default ports (can be changed in docker-compose.yml):

- **3001**: HTTP traffic (mapped to host)
- **3443**: HTTPS traffic (mapped to host)
- **3000**: API internal port (not exposed to host)

To change host ports, edit `docker-compose.yml`:

```yaml
caddy:
  ports:
    - "8001:80"    # Use port 8001 instead of 3001
    - "8443:443"   # Use port 8443 instead of 3443
```

## Health Checks

### API Container Health Check
- **Endpoint**: `/api/health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Retries**: 3 attempts
- **Start period**: 10 seconds

### Caddy Health Check
Caddy performs active health checks on the API:
- **URI**: `/api/health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds

### Additional Health Endpoints
- `/api/health/live` - Liveness probe
- `/api/health/ready` - Readiness probe
- `/api/health/metrics` - Terminus health indicators

## Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
docker-compose logs api

# Verify environment variables
docker-compose exec api env

# Rebuild without cache
docker-compose build --no-cache api
```

### Environment Validation Fails

```bash
# Check logs for validation errors
docker-compose logs api | grep -i "error"

# Common issues:
# - Missing required variables (GUS_USER_KEY, CEIDG_JWT_TOKEN, APP_API_KEYS)
# - Invalid variable formats (length requirements)
# - Production safety checks (CORS_ORIGINS wildcard in production)
```

### Port Already in Use

```bash
# Find process using port 3001
sudo lsof -i :3001

# Kill process or change port in docker-compose.yml
```

### API Not Accessible

```bash
# Check if containers are running
docker-compose ps

# Check API health directly
docker-compose exec api wget -qO- http://localhost:3000/api/health

# Check Caddy configuration
docker-compose exec caddy caddy validate --config /etc/caddy/Caddyfile

# Test network connectivity
docker-compose exec caddy wget -qO- http://api:3000/api/health
```

### External API Errors

```bash
# View detailed logs
docker-compose logs -f api

# Common issues:
# - Invalid GUS_USER_KEY
# - Invalid CEIDG_JWT_TOKEN
# - Network connectivity to external APIs
# - Rate limiting (429 errors)
# - Timeout errors (increase REQUEST_TIMEOUT)
```

### Performance Issues

```bash
# Monitor resource usage
docker stats

# Check memory health indicator
curl http://localhost:3001/api/health/metrics

# Increase container memory limit in docker-compose.yml
# (add under api service)
deploy:
  resources:
    limits:
      memory: 512M
```

## Production Checklist

Before deploying to production:

- [ ] Configure all required environment variables in `.env`
- [ ] Set strong, unique API keys (32+ characters)
- [ ] Configure proper domain in Caddyfile
- [ ] Set specific CORS origins (no wildcards)
- [ ] Review and adjust rate limiting settings
- [ ] Test external API connectivity (GUS, CEIDG, KRS)
- [ ] Set up monitoring and alerting
- [ ] Configure log aggregation
- [ ] Set up backup strategy for Caddy volumes
- [ ] Test HTTPS certificate renewal
- [ ] Review timeout settings for external APIs
- [ ] Set up proper DNS records for domain
- [ ] Configure firewall rules
- [ ] Test health check endpoints

## Security Considerations

### Container Security
- Non-root user execution (user: nestjs, uid: 1001)
- Minimal Alpine base image
- Production dependencies only
- Read-only Caddyfile mount

### Application Security
- API key authentication (always active)
- Rate limiting (enabled in production)
- Helmet.js security headers
- CORS configuration
- Input validation (Zod schemas)
- Error sanitization (no stack traces in production)

### Network Security
- Internal Docker network isolation
- Only Caddy exposes ports to host
- Health checks on internal network

### Recommendations
- Keep Docker images updated
- Regular security audits of dependencies
- Rotate API keys periodically
- Monitor for suspicious activity in logs
- Use secrets management for sensitive data
- Enable automatic security updates on host

## Monitoring and Logging

### Log Access
```bash
# Real-time logs
docker-compose logs -f api

# Filter by log level (NestJS logs)
docker-compose logs api | grep -i "error"
docker-compose logs api | grep -i "warn"
```

### Health Monitoring
```bash
# Basic health check
curl http://localhost:3001/api/health

# Detailed metrics
curl http://localhost:3001/api/health/metrics
```

### Performance Monitoring
```bash
# Container stats
docker stats thespace-api

# Memory usage
curl http://localhost:3001/api/health/metrics | grep -i memory
```

### Log Aggregation (Recommended)
Consider integrating with:
- ELK Stack (Elasticsearch, Logstash, Kibana)
- Grafana Loki
- CloudWatch Logs (AWS)
- Google Cloud Logging

## Backup and Restore

### Backup Caddy Data (certificates)
```bash
docker run --rm \
  -v unified-company-data-server_caddy_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/caddy-backup.tar.gz -C /data .
```

### Restore Caddy Data
```bash
docker run --rm \
  -v unified-company-data-server_caddy_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/caddy-backup.tar.gz -C /data
```

### Backup Environment Configuration
```bash
# Encrypt .env file before backup
gpg --symmetric --cipher-algo AES256 .env
# Creates .env.gpg

# Store .env.gpg securely
# Never commit unencrypted .env to version control
```

## Scaling Considerations

### Horizontal Scaling
To run multiple API instances:

```yaml
# docker-compose.yml
api:
  deploy:
    replicas: 3
  # ... rest of configuration
```

**Note**: GUS API rate limiting is per-instance. Adjust `GUS_RATE_LIMIT_PER_SECOND` accordingly.

### Load Balancing
Caddy supports load balancing across multiple backends:

```caddyfile
reverse_proxy api:3000 api-2:3000 api-3:3000 {
    lb_policy round_robin
    health_uri /api/health
}
```

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Caddy Documentation](https://caddyserver.com/docs/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Project Architecture](.claude/architecture.md)
- [API Reference](.claude/api-reference.md)
- [Development Guide](.claude/development-guide.md)
