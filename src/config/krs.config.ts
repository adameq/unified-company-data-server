import { type Environment } from './environment.schema';

/**
 * KRS Service Configuration
 *
 * Configuration for Polish National Court Register (KRS) REST API integration.
 * Includes registry fallback mechanisms and retry policies.
 *
 * Note: Retry logic (canRetry decisions) is implemented in retry.machine.ts
 * via canBeRetriedByService() function. This config contains only data.
 */

export interface KrsConfig {
  baseUrl: string;
  timeout: number;
  retryPolicy: {
    maxRetries: number;
    initialDelay: number;
  };
  registryFallback: {
    primary: 'P';
    fallback: 'S';
  };
}

export const createKrsConfig = (env: Environment): KrsConfig => ({
  baseUrl: env.KRS_BASE_URL,
  timeout: env.EXTERNAL_API_TIMEOUT,
  retryPolicy: {
    maxRetries: env.KRS_MAX_RETRIES,
    initialDelay: env.KRS_INITIAL_DELAY,
  },
  registryFallback: {
    primary: 'P', // Entrepreneurs registry
    fallback: 'S', // Associations registry
  },
});

/**
 * Default KRS configuration for development
 */
export const defaultKrsConfig: KrsConfig = createKrsConfig({
  KRS_BASE_URL: 'https://api-krs.ms.gov.pl',
  EXTERNAL_API_TIMEOUT: 5000,
  KRS_MAX_RETRIES: 2,
  KRS_INITIAL_DELAY: 200,
} as Environment);
