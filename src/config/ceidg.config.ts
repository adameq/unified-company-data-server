import { type Environment } from './environment.schema';

/**
 * CEIDG Service Configuration
 *
 * Configuration for Polish CEIDG (Central Registration and Information on Business)
 * v3 REST API integration. Includes JWT authentication, rate limiting, and retry policies.
 *
 * Note: Retry logic (canRetry decisions) is implemented via RetryStrategy pattern.
 * Each service has its own strategy class (e.g., CeidgRetryStrategy).
 * This config contains only data (maxRetries, initialDelay).
 */

export interface CeidgConfig {
  baseUrl: string;
  authentication: {
    type: 'Bearer';
    token: string;
  };
  timeout: number;
  retryPolicy: {
    maxRetries: number;
    initialDelay: number;
  };
  rateLimiting: {
    limit: number;
    period: number;
    retryAfter: number;
  };
}

export const createCeidgConfig = (env: Environment): CeidgConfig => ({
  baseUrl: env.CEIDG_BASE_URL,
  authentication: {
    type: 'Bearer',
    token: env.CEIDG_JWT_TOKEN,
  },
  timeout: env.EXTERNAL_API_TIMEOUT,
  retryPolicy: {
    maxRetries: env.CEIDG_MAX_RETRIES,
    initialDelay: env.CEIDG_INITIAL_DELAY,
  },
  rateLimiting: {
    limit: 1000,
    period: 60 * 60 * 1000, // 60 minutes in milliseconds
    retryAfter: 3600, // Wait 1 hour after rate limit hit
  },
});

/**
 * Default CEIDG configuration for development
 */
export const defaultCeidgConfig: CeidgConfig = createCeidgConfig({
  CEIDG_BASE_URL: 'https://dane.biznes.gov.pl/api/ceidg/v3',
  CEIDG_JWT_TOKEN: 'test-ceidg-token',
  EXTERNAL_API_TIMEOUT: 5000,
  CEIDG_MAX_RETRIES: 2,
  CEIDG_INITIAL_DELAY: 150,
} as Environment);
