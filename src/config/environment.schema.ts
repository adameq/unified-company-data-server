import { z } from 'zod';

export const EnvironmentSchema = z
  .object({
    // Server Configuration
    NODE_ENV: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // External API Credentials
  GUS_USER_KEY: z.string().min(1).describe('GUS SOAP API user key'),
  CEIDG_JWT_TOKEN: z.string().min(1).describe('CEIDG v3 API JWT token'),

  // API Keys for Authentication
  VALID_API_KEYS: z
    .string()
    .transform((str) => str.split(',').map((key) => key.trim()))
    .refine(
      (keys) => keys.every((key) => key.length >= 32),
      'Each API key must be at least 32 characters',
    ),

  // Performance Configuration
  REQUEST_TIMEOUT: z.coerce.number().int().min(1000).max(30000).default(15000),
  EXTERNAL_API_TIMEOUT: z.coerce
    .number()
    .int()
    .min(1000)
    .max(10000)
    .default(5000),

  // Rate Limiting
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(100),

  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),

  // External API Base URLs
  // WARNING: Development defaults provided for convenience.
  // Production deployments MUST explicitly set these environment variables
  // to avoid accidental connections to test/public endpoints.
  GUS_BASE_URL: z
    .string()
    .url()
    .default('https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc')
    .describe('GUS SOAP API base URL - MUST be explicitly set in production'),
  GUS_WSDL_URL: z
    .string()
    .url()
    .default(
      'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-prod.wsdl',
    )
    .describe('GUS WSDL definition URL - MUST be explicitly set in production'),
  KRS_BASE_URL: z
    .string()
    .url()
    .default('https://api-krs.ms.gov.pl')
    .describe('KRS REST API base URL - MUST be explicitly set in production'),
  CEIDG_BASE_URL: z
    .string()
    .url()
    .default('https://dane.biznes.gov.pl/api/ceidg/v3')
    .describe('CEIDG v3 REST API base URL - MUST be explicitly set in production'),

  // Retry Configuration per Service
  GUS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  GUS_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(100),
  KRS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  KRS_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(200),
  CEIDG_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CEIDG_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(150),

  // GUS Rate Limiting
  GUS_MAX_REQUESTS_PER_SECOND: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe(
      'Maximum requests per second for GUS API (token bucket rate limiter)',
    ),

  // Health Check Configuration
  HEALTH_CHECK_ENABLED: z.coerce.boolean().default(true),
  HEALTH_CHECK_TIMEOUT: z.coerce
    .number()
    .int()
    .min(1000)
    .max(10000)
    .default(3000),

  // Orchestration Timeouts
  ORCHESTRATION_TIMEOUT: z.coerce
    .number()
    .int()
    .min(5000)
    .max(60000)
    .default(30000)
    .describe('State machine orchestration timeout in milliseconds'),

  // Swagger Configuration
  SWAGGER_ENABLED: z.coerce.boolean().default(true),
  SWAGGER_SERVER_URL_DEVELOPMENT: z
    .string()
    .url()
    .default('http://localhost:3000')
    .describe('Development server URL for Swagger'),
  SWAGGER_SERVER_URL_PRODUCTION: z
    .string()
    .url()
    .optional()
    .describe('Production server URL for Swagger (optional)'),

  // CORS Configuration
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((str) => {
      // Special case: '*' means allow all origins (development only - not recommended)
      if (str === '*') {
        return ['*'];
      }
      // Parse comma-separated origins and trim whitespace
      return str.split(',').map((origin) => origin.trim()).filter(Boolean);
    })
    .describe('Comma-separated list of allowed CORS origins. Use "*" for all origins (not recommended).'),

  // Security Configuration
  ENABLE_HELMET: z.coerce.boolean().default(true).describe('Enable Helmet security headers middleware'),
  })
  .superRefine((config, ctx) => {
    // Production safety check: fail fast if using default URLs in production
    // IMPORTANT: This runs BEFORE .default() is applied, so we check process.env directly
    // to detect whether user explicitly provided values or Zod will use defaults
    if (config.NODE_ENV === 'production') {
      const usingDefaults: string[] = [];

      // Check raw process.env to detect missing explicit configuration
      if (!process.env.GUS_BASE_URL) usingDefaults.push('GUS_BASE_URL');
      if (!process.env.GUS_WSDL_URL) usingDefaults.push('GUS_WSDL_URL');
      if (!process.env.KRS_BASE_URL) usingDefaults.push('KRS_BASE_URL');
      if (!process.env.CEIDG_BASE_URL) usingDefaults.push('CEIDG_BASE_URL');

      if (usingDefaults.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Production environment detected with default API URLs! ' +
            'The following environment variables are using default values: ' +
            usingDefaults.join(', ') +
            '. This is a security risk. Please explicitly set these variables ' +
            'in your production environment to avoid unintended API connections.',
        });
      }

      // CORS security check for production
      // Note: CORS_ALLOWED_ORIGINS has .transform() that runs before this .superRefine()
      // So config.CORS_ALLOWED_ORIGINS is already an array at this point
      if (config.CORS_ALLOWED_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'CORS_ALLOWED_ORIGINS="*" not allowed in production environment. ' +
            'Allowing all origins creates CSRF vulnerability. ' +
            'Please set CORS_ALLOWED_ORIGINS to a comma-separated list of allowed domains. ' +
            'Example: CORS_ALLOWED_ORIGINS=https://yourapp.com,https://api.yourapp.com',
        });
      }
    }
  });

export type Environment = z.infer<typeof EnvironmentSchema>;
