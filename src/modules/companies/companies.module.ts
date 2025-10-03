import { Module } from '@nestjs/common';
import { CompaniesController } from './controllers/companies.controller';
import { HealthController } from './controllers/health.controller';
import { OrchestrationService } from './services/orchestration.service';
import { UnifiedDataMapper } from './mappers/unified-data.mapper';
import { ExternalApisModule } from '../external-apis/external-apis.module';
import { OrchestrationMachineProvider } from './state-machines/orchestration/orchestration.provider';

/**
 * Companies Module
 *
 * Main business logic module for company data operations:
 * - REST API controllers for company data endpoints
 * - Health check endpoints for monitoring external API dependencies
 * - Orchestration service with state machine coordination (XState v5 DI pattern)
 * - Integration with external API services
 *
 * Features:
 * - Unified company data retrieval by NIP
 * - State machine-based orchestration (XState v5 setup() + provide() pattern)
 * - Comprehensive error handling
 * - Request correlation tracking
 * - External service health monitoring via HealthController
 *
 * Architecture:
 * - Base orchestration machine registered via OrchestrationMachineProvider
 * - Concrete implementations injected via machine.provide() in OrchestrationService
 * - Eliminates Service Locator anti-pattern with proper dependency injection
 * - HealthController integrated here to avoid circular CommonModule dependency
 *
 * Exports:
 * - UnifiedDataMapper for data transformation in tests
 */

@Module({
  imports: [
    ExternalApisModule, // Import external API services
  ],
  controllers: [
    CompaniesController,
    HealthController, // Health check endpoints for external API monitoring
  ],
  providers: [
    OrchestrationMachineProvider, // Register base XState machine for DI
    OrchestrationService,
    UnifiedDataMapper,
  ],
  exports: [
    UnifiedDataMapper, // Export for testing and other modules
  ],
})
export class CompaniesModule {}
