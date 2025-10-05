import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { AppModule } from '../../src/app.module';
import type { Environment } from '../../src/config/environment.schema';
import { AppValidationPipe } from '../../src/modules/common/pipes/app-validation.pipe';
import { ThrottlerConfigService } from '../../src/modules/common/config/throttler.config';
import { getThrottlerConfigsArray } from '../../src/modules/common/config/throttler-limits.helper';

/**
 * Test App Setup Helpers
 *
 * Centralized test application setup to avoid code duplication across
 * integration test files. Follows DRY principle by providing reusable
 * functions for creating and configuring NestJS test applications.
 *
 * Benefits:
 * - Single source of truth for test app configuration
 * - Consistent setup across all integration tests
 * - Easy maintenance (update in one place)
 * - Flexible configuration via options
 *
 * Usage:
 * ```typescript
 * beforeAll(async () => {
 *   const { app: testApp } = await createTestApp();
 *   app = testApp;
 * });
 *
 * afterAll(async () => {
 *   await closeTestApp(app);
 * });
 * ```
 */

/**
 * Options for configuring test application
 */
export interface TestAppOptions {
  /**
   * Enable global ValidationPipe with production-like configuration
   * Matches the ValidationPipe setup in main.ts
   *
   * Use this when testing:
   * - Input validation errors
   * - DTO transformation
   * - Whitelist/forbidNonWhitelisted behavior
   *
   * @default false
   */
  withValidationPipe?: boolean;

  /**
   * Retrieve ConfigService instance from the application
   * Useful for tests that need to access configuration values
   *
   * Use this when testing:
   * - Configuration-dependent behavior
   * - Environment-specific logic
   * - Rate limiting configuration
   *
   * @default false
   */
  withConfigService?: boolean;

  /**
   * Enable rate limiting for testing
   *
   * By default, rate limiting is DISABLED in test environment to allow
   * rapid test execution without artificial limits. This option enables
   * rate limiting to test actual rate limit behavior.
   *
   * Use this when testing:
   * - Rate limit enforcement (429 responses)
   * - Rate limit headers (X-RateLimit-*, Retry-After)
   * - Per-API-key rate limit isolation
   * - Rate limit reset behavior
   *
   * IMPORTANT: Tests with rate limiting enabled will be slower as they
   * need to make 100+ requests to trigger rate limits.
   *
   * @default false
   */
  withRateLimiting?: boolean;
}

/**
 * Result object returned by createTestApp()
 */
export interface TestAppResult {
  /**
   * Initialized NestJS application instance
   */
  app: INestApplication;

  /**
   * ConfigService instance (only if withConfigService: true)
   */
  configService?: ConfigService<Environment, true>;
}

/**
 * Create and configure a NestJS test application
 *
 * This function handles all the boilerplate setup required for integration tests:
 * 1. Creates a TestingModule with AppModule
 * 2. Compiles the module
 * 3. Creates the application instance
 * 4. Optionally configures ValidationPipe
 * 5. Initializes the application
 * 6. Optionally retrieves ConfigService
 *
 * @param options - Configuration options for the test app
 * @returns Promise resolving to TestAppResult with app and optional configService
 *
 * @example
 * // Basic setup (no ValidationPipe)
 * const { app } = await createTestApp();
 *
 * @example
 * // With ValidationPipe (for testing input validation)
 * const { app } = await createTestApp({ withValidationPipe: true });
 *
 * @example
 * // With ConfigService (for testing configuration)
 * const { app, configService } = await createTestApp({ withConfigService: true });
 *
 * @example
 * // With both ValidationPipe and ConfigService
 * const { app, configService } = await createTestApp({
 *   withValidationPipe: true,
 *   withConfigService: true,
 * });
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestAppResult> {
  const { withValidationPipe = false, withConfigService = false, withRateLimiting = false } = options;

  // Create testing module builder
  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  // Override rate limiting configuration if requested
  if (withRateLimiting) {
    // Override ThrottlerConfigService to enable rate limiting in tests
    // By default, rate limiting is disabled in NODE_ENV=test (see throttler.config.ts skipIf)
    // This override forces rate limiting to be active for testing purposes
    moduleBuilder = moduleBuilder.overrideProvider(ThrottlerConfigService)
      .useValue({
        createThrottlerOptions: () => {
          const configService = new ConfigService();
          const rateLimitPerMinute = Number(process.env.APP_RATE_LIMIT_PER_MINUTE || 100);

          // Use centralized helper to calculate throttler limits
          // This ensures consistency with production configuration
          const throttlers = getThrottlerConfigsArray(rateLimitPerMinute);

          return {
            throttlers,
            storage: undefined,

            // OVERRIDE: Always enable rate limiting when withRateLimiting: true
            skipIf: (context: ExecutionContext) => {
              const request = context.switchToHttp().getRequest();
              const path = request.path;

              // Still skip health check endpoints
              if (path?.startsWith('/api/health')) {
                return true;
              }

              // DO NOT skip for test environment (this is the key change)
              return false;
            },

            generateKey: (context: ExecutionContext, trackerName: string) => {
              const request = context.switchToHttp().getRequest();
              const authHeader = request.headers.authorization;

              if (authHeader && authHeader.startsWith('Bearer ')) {
                const apiKey = authHeader.substring(7);
                // Use SHA256 hash (same as production) to ensure consistent behavior
                const apiKeyHash = createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
                return `${trackerName}:${apiKeyHash}`;
              }

              const ip = request.ip || 'unknown';
              return `${trackerName}:${ip}`;
            },

            errorMessage: 'Rate limit exceeded. Please try again later.',
          };
        },
      });
  }

  // Compile the testing module
  const moduleFixture: TestingModule = await moduleBuilder.compile();

  // Create application instance
  const app = moduleFixture.createNestApplication();

  // Configure AppValidationPipe if requested
  // This matches the exact configuration from main.ts
  // AppValidationPipe extends ValidationPipe to ensure ALL validation errors
  // (including whitelist violations) are converted to structured ValidationException
  if (withValidationPipe) {
    app.useGlobalPipes(
      new AppValidationPipe({
        // Remove properties not in DTO
        whitelist: true,

        // Reject requests with extra properties
        forbidNonWhitelisted: true,

        // Automatically transform payloads to DTO instances
        transform: true,

        // Collect all validation errors (not just first)
        stopAtFirstError: false,

        // Reject unknown values
        forbidUnknownValues: true,

        // Validate custom decorators
        validateCustomDecorators: true,
      }),
    );
  }

  // Initialize the application
  // This triggers all lifecycle hooks and ensures app is ready for requests
  await app.init();

  // Build result object
  const result: TestAppResult = { app };

  // Retrieve ConfigService if requested
  if (withConfigService) {
    result.configService = app.get(ConfigService);
  }

  return result;
}

/**
 * Close and cleanup test application
 *
 * Properly shuts down the NestJS application and releases all resources.
 * Should be called in afterAll() hook to ensure clean test teardown.
 *
 * @param app - The NestJS application instance to close
 *
 * @example
 * afterAll(async () => {
 *   await closeTestApp(app);
 * });
 */
export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
}
