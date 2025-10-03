import { type Environment } from './environment.schema';

/**
 * GUS Service Configuration
 *
 * Configuration for Polish Statistical Office (GUS) SOAP API integration.
 * Includes session management, retry policies, and authentication settings.
 *
 * Note: Retry logic (canRetry decisions) is implemented via RetryStrategy pattern.
 * Each service has its own strategy class (e.g., GusRetryStrategy).
 * This config contains only data (maxRetries, initialDelay).
 */

export interface GusConfig {
  baseUrl: string;
  wsdlUrl: string;
  userKey: string;
  timeout: number;
  retryPolicy: {
    maxRetries: number;
    initialDelay: number;
  };
  sessionManagement: {
    timeout: number;
    refreshBuffer: number;
  };
}

export const createGusConfig = (env: Environment): GusConfig => ({
  baseUrl: env.GUS_BASE_URL,
  wsdlUrl: env.GUS_WSDL_URL,
  userKey: env.GUS_USER_KEY,
  timeout: env.EXTERNAL_API_TIMEOUT,
  retryPolicy: {
    maxRetries: env.GUS_MAX_RETRIES,
    initialDelay: env.GUS_INITIAL_DELAY,
  },
  sessionManagement: {
    timeout: 30 * 60 * 1000, // 30 minutes in milliseconds
    refreshBuffer: 5 * 60 * 1000, // Refresh 5 minutes before expiry
  },
});

/**
 * Default GUS configuration for development
 */
export const defaultGusConfig: GusConfig = createGusConfig({
  GUS_BASE_URL:
    'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
  GUS_WSDL_URL:
    'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-prod.wsdl',
  GUS_USER_KEY: 'test-gus-key',
  EXTERNAL_API_TIMEOUT: 5000,
  GUS_MAX_RETRIES: 2,
  GUS_INITIAL_DELAY: 100,
} as Environment);
