import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './modules/common/common.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ExternalApisModule } from './modules/external-apis/external-apis.module';
import { EnvironmentSchema } from './config/environment.schema';

/**
 * Root Application Module
 *
 * Orchestrates all feature modules and global configuration:
 * - Global configuration (environment variables)
 * - Common module (health checks, auth, rate limiting, error handling)
 * - Companies module (main business logic)
 * - External APIs module (GUS, KRS, CEIDG integrations)
 *
 * Constitutional compliance:
 * - Modular architecture with clear separation of concerns
 * - Global interceptors and guards for cross-cutting concerns
 * - Centralized configuration management
 * - Comprehensive error handling and logging
 */

@Module({
  imports: [
    // Global configuration module with Zod validation
    // Multi-environment support with proper override order:
    // - Base configuration: .env (default values, shared config)
    // - Environment overrides: .env.{NODE_ENV} (environment-specific values)
    // - Later files override earlier files (via spread operator)
    //
    // Load order (left to right):
    // 1. .env - base configuration (loaded first)
    // 2. .env.{NODE_ENV} - environment-specific overrides (loaded second, overrides base)
    //
    // Example with NODE_ENV=test:
    // - .env provides: GUS_BASE_URL=https://wyszukiwarkaregon.stat.gov.pl (production)
    // - .env.test overrides: GUS_BASE_URL=https://wyszukiwarkaregontest.stat.gov.pl (test)
    // - Final result: test environment URL is used ✅
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env',                                           // Base config (loaded first)
        `.env.${process.env.NODE_ENV || 'development'}`, // Environment overrides (loaded second, overrides base)
      ],
      cache: true,
      validate: (config) => EnvironmentSchema.parse(config),
    }),

    // Feature modules
    ExternalApisModule,
    CompaniesModule,
    CommonModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
