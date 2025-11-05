import { z } from 'zod';

/**
 * Hardcoded default values for production validation
 *
 * These constants are used in .superRefine() to detect when production
 * environments are using default URLs instead of explicit configuration.
 *
 * PRODUCTION ENVIRONMENT:
 * - Uses production GUS API (current, live data)
 * - Requires registered API key from GUS
 * - Subject to rate limits and quotas
 */
const DEFAULT_GUS_BASE_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const DEFAULT_GUS_WSDL_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-prod.wsdl';
const DEFAULT_KRS_BASE_URL = 'https://api-krs.ms.gov.pl';
const DEFAULT_CEIDG_BASE_URL = 'https://dane.biznes.gov.pl/api/ceidg/v3';

/**
 * Test environment constants for GUS API
 *
 * GUS provides a dedicated test environment with:
 * - Full database snapshot from 8.11.2014 (outdated but complete)
 * - Anonymized personal names and addresses
 * - No registration required - test key works immediately
 * - No rate limits or quotas
 * - Stable data for consistent testing
 *
 * TEST ENVIRONMENT:
 * - URL: https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc
 * - WSDL: https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-test.wsdl
 * - API Key: abcde12345abcde12345 (public test key)
 *
 * Usage: Set these values in .env.test or .env.development for testing
 */
const TEST_GUS_BASE_URL = 'https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const TEST_GUS_WSDL_URL = 'https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-test.wsdl';
const TEST_GUS_USER_KEY = 'abcde12345abcde12345';

export const EnvironmentSchema = z
  .object({
    // Server Configuration
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // External API Credentials
    GUS_USER_KEY: z.string().min(1).describe('GUS SOAP API user key'),
    CEIDG_JWT_TOKEN: z.string().min(1).describe('CEIDG v3 API JWT token'),

    // Application-level API Keys for Authentication
    APP_API_KEYS: z
      .string()
      .default('dev_api_key_1234567890abcdef1234567890abcdef')
      .transform((str) => str.split(',').map((key) => key.trim()))
      .refine(
        (keys) => keys.every((key) => key.length >= 32),
        'Each API key must be at least 32 characters',
      ),

    // Application-level Performance Configuration
    APP_REQUEST_TIMEOUT: z.coerce.number().int().min(1000).max(30000).default(15000),
    APP_EXTERNAL_API_TIMEOUT: z.coerce.number().int().min(1000).max(10000).default(5000),

    // Application-level Rate Limiting (incoming requests)
    APP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(100),

    // External API Base URLs
    // WARNING: Development defaults provided for convenience.
    // Production deployments MUST explicitly set these environment variables
    // to avoid accidental connections to test/public endpoints.
    GUS_BASE_URL: z
      .string()
      .url()
      .default(DEFAULT_GUS_BASE_URL)
      .describe('GUS SOAP API base URL - MUST be explicitly set in production'),
    GUS_WSDL_URL: z
      .string()
      .url()
      .default(DEFAULT_GUS_WSDL_URL)
      .describe('GUS WSDL definition URL - MUST be explicitly set in production'),
    KRS_BASE_URL: z
      .string()
      .url()
      .default(DEFAULT_KRS_BASE_URL)
      .describe('KRS REST API base URL - MUST be explicitly set in production'),
    CEIDG_BASE_URL: z
      .string()
      .url()
      .default(DEFAULT_CEIDG_BASE_URL)
      .describe('CEIDG v3 REST API base URL - MUST be explicitly set in production'),

    // Retry Configuration per Service
    GUS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    GUS_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(100),
    KRS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    KRS_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(200),
    CEIDG_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    CEIDG_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(150),

    // GUS-specific Rate Limiting (outgoing requests to GUS API)
    GUS_MAX_REQUESTS_PER_SECOND: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe(
        'Maximum requests per second for GUS API (token bucket rate limiter)',
      ),

    // Application-level Health Check Configuration
    APP_HEALTH_CHECK_ENABLED: z.coerce.boolean().default(true),
    APP_HEALTH_CHECK_TIMEOUT: z.coerce.number().int().min(1000).max(10000).default(3000),

    // Application-level Orchestration Timeouts
    APP_ORCHESTRATION_TIMEOUT: z.coerce.number().int().min(5000).max(60000).default(30000),

    // Application-level Swagger Configuration
    APP_SWAGGER_ENABLED: z.coerce.boolean().default(true),
    APP_SWAGGER_SERVER_URL_DEVELOPMENT: z.string().url().default('http://localhost:3000'),
    APP_SWAGGER_SERVER_URL_PRODUCTION: z.string().url().optional(),

    // Application-level CORS Configuration
    APP_CORS_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:5173')
      .transform((str) => {
        if (str === '*') return ['*'];
        return str.split(',').map((origin) => origin.trim()).filter(Boolean);
      }),

    // Application-level Security Configuration
    APP_ENABLE_HELMET: z.coerce.boolean().default(true),
  })
  .superRefine((config, ctx) => {
    // Production safety check: fail fast if API URLs not explicitly configured
    // We check process.env directly to ensure variables were explicitly set,
    // even if their values match the defaults (which is valid for production Polish gov APIs)
    // Test and development environments are allowed to rely on defaults
    if (config.NODE_ENV === 'production') {
      const missingExplicitConfig: string[] = [];

      // Check if environment variables were explicitly provided
      // This ensures intentional configuration without blocking legitimate production URLs
      if (!process.env.GUS_BASE_URL) missingExplicitConfig.push('GUS_BASE_URL');
      if (!process.env.GUS_WSDL_URL) missingExplicitConfig.push('GUS_WSDL_URL');
      if (!process.env.KRS_BASE_URL) missingExplicitConfig.push('KRS_BASE_URL');
      if (!process.env.CEIDG_BASE_URL) missingExplicitConfig.push('CEIDG_BASE_URL');

      if (missingExplicitConfig.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Production environment requires explicit API URL configuration! ' +
            'The following environment variables must be explicitly set: ' +
            missingExplicitConfig.join(', ') +
            '. Even if using default values, you must set them explicitly ' +
            'in your production environment to ensure intentional configuration.',
        });
      }

      // CORS security check for production
      const corsOrigins = config.APP_CORS_ALLOWED_ORIGINS;
      if (corsOrigins && corsOrigins.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'APP_CORS_ALLOWED_ORIGINS="*" not allowed in production environment. ' +
            'Allowing all origins creates CSRF vulnerability. ' +
            'Please set APP_CORS_ALLOWED_ORIGINS to a comma-separated list of allowed domains. ' +
            'Example: APP_CORS_ALLOWED_ORIGINS=https://yourapp.com,https://api.yourapp.com',
        });
      }
    }
  });

export type Environment = z.infer<typeof EnvironmentSchema>;
