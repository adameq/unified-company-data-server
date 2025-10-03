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

  // Application-level API Keys for Authentication
  // New naming convention: APP_* prefix for application-level configuration
  APP_API_KEYS: z
    .string()
    .optional()
    .transform((str) => str?.split(',').map((key) => key.trim()))
    .refine(
      (keys) => !keys || keys.every((key) => key.length >= 32),
      'Each API key must be at least 32 characters',
    ),
  // Deprecated: Use APP_API_KEYS instead (backward compatibility)
  VALID_API_KEYS: z
    .string()
    .optional()
    .transform((str) => str?.split(',').map((key) => key.trim()))
    .refine(
      (keys) => !keys || keys.every((key) => key.length >= 32),
      'Each API key must be at least 32 characters',
    ),

  // Application-level Performance Configuration
  APP_REQUEST_TIMEOUT: z.coerce.number().int().min(1000).max(30000).optional(),
  REQUEST_TIMEOUT: z.coerce.number().int().min(1000).max(30000).optional(), // Deprecated

  APP_EXTERNAL_API_TIMEOUT: z.coerce.number().int().min(1000).max(10000).optional(),
  EXTERNAL_API_TIMEOUT: z.coerce.number().int().min(1000).max(10000).optional(), // Deprecated

  // Application-level Rate Limiting (incoming requests)
  APP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).optional(), // Deprecated

  // Application-level Logging Configuration
  APP_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(), // Deprecated

  APP_LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(), // Deprecated

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
  APP_HEALTH_CHECK_ENABLED: z.coerce.boolean().optional(),
  HEALTH_CHECK_ENABLED: z.coerce.boolean().optional(), // Deprecated

  APP_HEALTH_CHECK_TIMEOUT: z.coerce.number().int().min(1000).max(10000).optional(),
  HEALTH_CHECK_TIMEOUT: z.coerce.number().int().min(1000).max(10000).optional(), // Deprecated

  // Application-level Orchestration Timeouts
  APP_ORCHESTRATION_TIMEOUT: z.coerce.number().int().min(5000).max(60000).optional(),
  ORCHESTRATION_TIMEOUT: z.coerce.number().int().min(5000).max(60000).optional(), // Deprecated

  // Application-level Swagger Configuration
  APP_SWAGGER_ENABLED: z.coerce.boolean().optional(),
  SWAGGER_ENABLED: z.coerce.boolean().optional(), // Deprecated

  APP_SWAGGER_SERVER_URL_DEVELOPMENT: z.string().url().optional(),
  SWAGGER_SERVER_URL_DEVELOPMENT: z.string().url().optional(), // Deprecated

  APP_SWAGGER_SERVER_URL_PRODUCTION: z.string().url().optional(),
  SWAGGER_SERVER_URL_PRODUCTION: z.string().url().optional(), // Deprecated

  // Application-level CORS Configuration
  APP_CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((str) => {
      if (!str) return undefined;
      if (str === '*') return ['*'];
      return str.split(',').map((origin) => origin.trim()).filter(Boolean);
    }),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((str) => {
      if (!str) return undefined;
      if (str === '*') return ['*'];
      return str.split(',').map((origin) => origin.trim()).filter(Boolean);
    }), // Deprecated

  // Application-level Security Configuration
  APP_ENABLE_HELMET: z.coerce.boolean().optional(),
  ENABLE_HELMET: z.coerce.boolean().optional(), // Deprecated
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
      // Note: APP_CORS_ALLOWED_ORIGINS/CORS_ALLOWED_ORIGINS has .transform() that runs before this .superRefine()
      // So the value is already an array at this point (or undefined if not set)
      const corsOrigins = config.APP_CORS_ALLOWED_ORIGINS || config.CORS_ALLOWED_ORIGINS;
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
  })
  .transform((config) => {
    // Backward compatibility: Migrate from old names to new APP_* names
    // If new name is not set, fallback to old name, then to default value

    return {
      ...config,

      // API Keys: APP_API_KEYS or VALID_API_KEYS (required)
      APP_API_KEYS: config.APP_API_KEYS || config.VALID_API_KEYS || [],

      // Timeouts: prefer APP_* names, fallback to old names, then defaults
      APP_REQUEST_TIMEOUT: config.APP_REQUEST_TIMEOUT ?? config.REQUEST_TIMEOUT ?? 15000,
      APP_EXTERNAL_API_TIMEOUT: config.APP_EXTERNAL_API_TIMEOUT ?? config.EXTERNAL_API_TIMEOUT ?? 5000,
      APP_ORCHESTRATION_TIMEOUT: config.APP_ORCHESTRATION_TIMEOUT ?? config.ORCHESTRATION_TIMEOUT ?? 30000,

      // Rate Limiting
      APP_RATE_LIMIT_PER_MINUTE: config.APP_RATE_LIMIT_PER_MINUTE ?? config.RATE_LIMIT_PER_MINUTE ?? 100,

      // Logging
      APP_LOG_LEVEL: config.APP_LOG_LEVEL ?? config.LOG_LEVEL ?? 'info',
      APP_LOG_FORMAT: config.APP_LOG_FORMAT ?? config.LOG_FORMAT ?? 'pretty',

      // Health Checks
      APP_HEALTH_CHECK_ENABLED: config.APP_HEALTH_CHECK_ENABLED ?? config.HEALTH_CHECK_ENABLED ?? true,
      APP_HEALTH_CHECK_TIMEOUT: config.APP_HEALTH_CHECK_TIMEOUT ?? config.HEALTH_CHECK_TIMEOUT ?? 3000,

      // Swagger
      APP_SWAGGER_ENABLED: config.APP_SWAGGER_ENABLED ?? config.SWAGGER_ENABLED ?? true,
      APP_SWAGGER_SERVER_URL_DEVELOPMENT: config.APP_SWAGGER_SERVER_URL_DEVELOPMENT ?? config.SWAGGER_SERVER_URL_DEVELOPMENT ?? 'http://localhost:3000',
      APP_SWAGGER_SERVER_URL_PRODUCTION: config.APP_SWAGGER_SERVER_URL_PRODUCTION ?? config.SWAGGER_SERVER_URL_PRODUCTION,

      // CORS
      APP_CORS_ALLOWED_ORIGINS: config.APP_CORS_ALLOWED_ORIGINS ?? config.CORS_ALLOWED_ORIGINS ?? ['http://localhost:3000', 'http://localhost:5173'],

      // Security
      APP_ENABLE_HELMET: config.APP_ENABLE_HELMET ?? config.ENABLE_HELMET ?? true,
    };
  });

// Export base type inferred from schema
type EnvironmentBase = z.infer<typeof EnvironmentSchema>;

// Export final type with APP_* fields guaranteed to be non-undefined (from .transform() defaults)
export type Environment = EnvironmentBase & {
  // Application-level configuration (always defined after .transform())
  APP_API_KEYS: string[];
  APP_REQUEST_TIMEOUT: number;
  APP_EXTERNAL_API_TIMEOUT: number;
  APP_ORCHESTRATION_TIMEOUT: number;
  APP_RATE_LIMIT_PER_MINUTE: number;
  APP_LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
  APP_LOG_FORMAT: 'json' | 'pretty';
  APP_HEALTH_CHECK_ENABLED: boolean;
  APP_HEALTH_CHECK_TIMEOUT: number;
  APP_SWAGGER_ENABLED: boolean;
  APP_SWAGGER_SERVER_URL_DEVELOPMENT: string;
  APP_SWAGGER_SERVER_URL_PRODUCTION: string | undefined;
  APP_CORS_ALLOWED_ORIGINS: string[];
  APP_ENABLE_HELMET: boolean;
};
