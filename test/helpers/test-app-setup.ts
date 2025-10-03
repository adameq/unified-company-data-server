import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import type { Environment } from '../../src/config/environment.schema';

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
  const { withValidationPipe = false, withConfigService = false } = options;

  // Create testing module with AppModule
  // AppModule contains all application configuration including:
  // - Environment validation (ConfigModule)
  // - Global exception filters
  // - API key authentication guards
  // - Rate limiting (disabled in test environment)
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // Create application instance
  const app = moduleFixture.createNestApplication();

  // Configure ValidationPipe if requested
  // This matches the exact configuration from main.ts
  if (withValidationPipe) {
    app.useGlobalPipes(
      new ValidationPipe({
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

        // Use default BadRequestException (GlobalExceptionFilter handles it)
        // No custom exceptionFactory needed
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
