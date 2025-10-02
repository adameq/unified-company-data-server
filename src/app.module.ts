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
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
