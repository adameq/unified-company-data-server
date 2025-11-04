# GitHub Secrets Setup Guide - Backend API

Configuration guide for GitHub Secrets required for automated deployment of the Unified Company Data Server.

## Required GitHub Secrets

Navigate to: **Repository → Settings → Secrets and variables → Actions → New repository secret**

**Note:** `GHCR_TOKEN` is **NOT required** - we use built-in `GITHUB_TOKEN` which is automatically provided by GitHub Actions with proper permissions.

---

### Infrastructure Secrets

#### 1. HETZNER_SSH_HOST
**Value:** IP address or domain of Hetzner server
**Example:** `123.456.789.012`

#### 2. HETZNER_SSH_USER
**Value:** SSH username
**Example:** `root`

#### 3. HETZNER_SSH_KEY
**Value:** Private SSH key (full content including headers)
**Generate:**
```bash
ssh-keygen -t ed25519 -C "github-actions-api-deploy" -f ~/.ssh/github_api_deploy
ssh-copy-id -i ~/.ssh/github_api_deploy.pub user@server
cat ~/.ssh/github_api_deploy  # Copy entire output
```

---

### GUS API Secrets

#### 4. GUS_USER_KEY
**Value:** GUS SOAP API authentication key
**Obtain from:** https://api.stat.gov.pl/Home/RegonApi
**Requirement:** Minimum 20 characters
**Example:** `abcdefghij1234567890`

#### 5. GUS_BASE_URL (Optional)
**Value:** GUS API endpoint URL
**Default:** `https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc`
**Test environment:** `https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc`
**Note:** Omit to use default production URL

---

### CEIDG API Secrets

#### 6. CEIDG_JWT_TOKEN
**Value:** CEIDG v3 API JWT token
**Obtain from:** https://dane.biznes.gov.pl/
**Requirement:** Minimum 50 characters
**Example:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

#### 7. CEIDG_BASE_URL (Optional)
**Value:** CEIDG API endpoint URL
**Default:** `https://dane.biznes.gov.pl/api/ceidg/v2`
**Note:** Omit to use default

---

### KRS API Secrets

#### 8. KRS_BASE_URL (Optional)
**Value:** KRS API endpoint URL
**Default:** `https://api-krs.ms.gov.pl`
**Note:** No authentication required, omit to use default

---

### Application Secrets

#### 9. APP_API_KEYS (**REQUIRED**)
**Value:** Comma-separated API keys for client authentication
**Requirement:** Each key minimum 32 characters
**Generate:**
```bash
# Generate secure random keys
openssl rand -hex 32  # Run for each key needed
```
**Example:** `abc123...32chars,def456...32chars,ghi789...32chars`

**Important:** Share these keys with frontend application / API clients

#### 10. CORS_ORIGINS (**REQUIRED**)
**Value:** Allowed CORS origins (comma-separated)
**Requirement:** Cannot be `*` in production
**Example:** `https://yourdomain.com,https://app.yourdomain.com`
**Development:** `http://localhost:5173`

---

### Optional Performance Secrets

#### 11. REQUEST_TIMEOUT
**Value:** External API request timeout (milliseconds)
**Default:** `30000` (30 seconds)
**Example:** `45000`

#### 12. GUS_RATE_LIMIT_PER_SECOND
**Value:** Maximum requests/second to GUS API
**Default:** `10`
**Example:** `5` (conservative) or `15` (aggressive)

#### 13. THROTTLE_TTL
**Value:** Rate limit time window (milliseconds)
**Default:** `60000` (1 minute)
**Example:** `30000`

#### 14. THROTTLE_LIMIT
**Value:** Maximum requests per TTL window
**Default:** `100`
**Example:** `200` (higher traffic) or `50` (lower traffic)

---

## Adding Secrets - GitHub CLI Method

```bash
# Install GitHub CLI
brew install gh  # macOS
# or: https://cli.github.com/

# Login
gh auth login

# Infrastructure
gh secret set HETZNER_SSH_HOST --body "123.456.789.012"
gh secret set HETZNER_SSH_USER --body "root"
gh secret set HETZNER_SSH_KEY < ~/.ssh/github_api_deploy

# GUS API
gh secret set GUS_USER_KEY --body "your-gus-key"

# CEIDG API
gh secret set CEIDG_JWT_TOKEN --body "eyJhbGci..."

# Application
gh secret set APP_API_KEYS --body "$(openssl rand -hex 32),$(openssl rand -hex 32)"
gh secret set CORS_ORIGINS --body "https://yourdomain.com"

# Optional
gh secret set REQUEST_TIMEOUT --body "30000"
gh secret set GUS_RATE_LIMIT_PER_SECOND --body "10"
```

---

## Verification Checklist

- [ ] **Infrastructure:** SSH connection works from GitHub Actions
- [ ] **Workflow:** Has `packages: write` permission (already configured)
- [ ] **Repository Settings:** Actions have "Read and write permissions"
- [ ] **GUS:** API key is valid (test in development)
- [ ] **CEIDG:** JWT token is not expired
- [ ] **APP_API_KEYS:** Minimum 32 characters each
- [ ] **CORS_ORIGINS:** Matches frontend domain (production)

### Test Deployment

```bash
# Make a small change
git commit --allow-empty -m "Test CI/CD"
git push origin main

# Monitor: Repository → Actions → Build and Deploy API
# Check logs for errors
# Verify health: https://api.yourdomain.com/api/health
```

---

## Troubleshooting

### GUS API Authentication Fails
**Error:** `SOAP authentication failed`
**Solution:** Verify `GUS_USER_KEY` is correct, check GUS portal for key status

### CEIDG API 401 Unauthorized
**Error:** `Invalid JWT token`
**Solution:** Token may be expired, regenerate at https://dane.biznes.gov.pl/

### CORS Errors in Production
**Error:** `CORS policy blocked`
**Solution:** Ensure `CORS_ORIGINS` includes frontend domain (exact match, including protocol)

### APP_API_KEYS Validation Error
**Error:** `API keys must be at least 32 characters`
**Solution:** Regenerate longer keys using `openssl rand -hex 32`

---

## Security Best Practices

1. **Rotate secrets regularly:**
   - API keys: Every 6 months
   - SSH keys: Every 12 months
   - External API tokens: When provider recommends

2. **Monitor failed authentications:**
   - Check GitHub Actions logs
   - Review API error logs on server

3. **Use separate keys per environment:**
   - Development: Different API keys
   - Production: Secure, rotated keys

4. **Never commit secrets:**
   - `.env` in `.gitignore`
   - `.dockerignore` includes `.env`

---

## Next Steps

1. Configure all required secrets
2. Read [DEPLOYMENT_CI_CD.md](./DEPLOYMENT_CI_CD.md)
3. Setup server: [SETUP_SERVER.md](../SETUP_SERVER.md)
4. Test deployment with small change

---

## References

- [GitHub Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GUS API Documentation](https://api.stat.gov.pl/Home/RegonApi)
- [CEIDG API Documentation](https://dane.biznes.gov.pl/)
- [API Reference](.claude/api-reference.md)
