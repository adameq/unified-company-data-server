import { z } from 'zod';

export const EnvironmentSchema = z.object({
  // Server Configuration
  NODE_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // External API Credentials
  GUS_USER_KEY: z.string().min(32).describe('GUS SOAP API user key'),
  CEIDG_JWT_TOKEN: z.string().min(50).describe('CEIDG v3 API JWT token'),

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
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  // External API Base URLs
  GUS_BASE_URL: z
    .string()
    .url()
    .default(
      'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
    ),
  KRS_BASE_URL: z.string().url().default('https://api-krs.ms.gov.pl'),
  CEIDG_BASE_URL: z
    .string()
    .url()
    .default('https://dane.biznes.gov.pl/api/ceidg/v3'),

  // Retry Configuration per Service
  GUS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  GUS_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(100),
  KRS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  KRS_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(200),
  CEIDG_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CEIDG_INITIAL_DELAY: z.coerce.number().int().min(50).max(2000).default(150),

  // Health Check Configuration
  HEALTH_CHECK_ENABLED: z.coerce.boolean().default(true),
  HEALTH_CHECK_TIMEOUT: z.coerce
    .number()
    .int()
    .min(1000)
    .max(10000)
    .default(3000),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

// Validation helper
export function validateEnvironment(): Environment {
  try {
    return EnvironmentSchema.parse(process.env);
  } catch (error) {
    console.error('❌ Environment validation failed:', (error as any).errors);
    process.exit(1);
  }
}
