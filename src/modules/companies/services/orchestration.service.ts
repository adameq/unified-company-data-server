import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createActor, fromPromise, toPromise, type AnyActorRef } from 'xstate';
import { z } from 'zod';
import { UnifiedCompanyDataSchema } from '@schemas/unified-company-data.schema';
import type { ErrorResponse } from '@schemas/error-response.schema';
import { GusService } from '@modules/external-apis/gus/gus.service';
import { KrsService } from '@modules/external-apis/krs/krs.service';
import { CeidgV3Service } from '@modules/external-apis/ceidg/ceidg-v3.service';
import { UnifiedDataMapper } from '../mappers/unified-data.mapper';
import { BusinessException } from '@common/exceptions/business-exceptions';
import type { Environment } from '@config/environment.schema';
import {
  ORCHESTRATION_MACHINE,
  type OrchestrationMachineConfig,
} from '../state-machines/orchestration/orchestration.provider';
import { createRetryActor } from '../state-machines/retry-actor.factory';
import { GusRetryStrategy } from '../state-machines/strategies/gus-retry.strategy';
import { KrsRetryStrategy } from '../state-machines/strategies/krs-retry.strategy';
import { CeidgRetryStrategy } from '../state-machines/strategies/ceidg-retry.strategy';

/**
 * Orchestration Service - Bridge between Controllers and State Machines
 *
 * Responsibilities:
 * - Initialize and manage orchestration state machine
 * - Inject external service dependencies via machine.provide()
 * - Execute state machine and propagate exceptions to GlobalExceptionFilter
 * - Provide correlation tracking throughout the workflow
 * - Provide health check functionality for external service monitoring
 *
 * Error Handling Philosophy:
 * - All exceptions (BusinessException, ZodError, etc.) are propagated to GlobalExceptionFilter
 * - No error transformation or formatting in this service (Single Responsibility Principle)
 * - GlobalExceptionFilter is the single source of truth for error response formatting
 * - This keeps the service focused on orchestration logic, not error presentation
 *
 * Architecture:
 * - Uses XState v5 setup() + provide() pattern for dependency injection
 * - Base machine injected via ORCHESTRATION_MACHINE token
 * - Concrete service implementations injected via machine.provide()
 * - Eliminates Service Locator anti-pattern
 */

type UnifiedCompanyData = z.infer<typeof UnifiedCompanyDataSchema>;

@Injectable()
export class OrchestrationService implements OnModuleInit {
  private readonly logger = new Logger(OrchestrationService.name);
  private configuredMachine: any;
  private machineConfig!: OrchestrationMachineConfig;

  constructor(
    @Inject(ORCHESTRATION_MACHINE) private readonly baseMachine: any,
    private readonly gusService: GusService,
    private readonly krsService: KrsService,
    private readonly ceidgService: CeidgV3Service,
    private readonly unifiedDataMapper: UnifiedDataMapper,
    private readonly configService: ConfigService<Environment, true>,
    // Retry strategies injected via DI (follows Dependency Inversion Principle)
    private readonly gusRetryStrategy: GusRetryStrategy,
    private readonly krsRetryStrategy: KrsRetryStrategy,
    private readonly ceidgRetryStrategy: CeidgRetryStrategy,
  ) {
    this.logger.log('OrchestrationService initialized', {
      architecture: 'XState v5 with DI + Strategy Pattern',
      healthCheckStrategy: 'live (no caching)',
      retryStrategies: [
        this.gusRetryStrategy.name,
        this.krsRetryStrategy.name,
        this.ceidgRetryStrategy.name,
      ],
    });
  }

  /**
   * Module initialization hook - configure state machine once at startup
   *
   * This method is called by NestJS after all dependencies are injected.
   * Pre-configures the orchestration machine to avoid repeated configuration
   * on every request.
   *
   * Performance impact:
   * - Before: Config + machine.provide() executed per request (100s-1000s times)
   * - After: Executed once at module initialization
   */
  async onModuleInit() {
    this.machineConfig = this.buildMachineConfig();
    this.configuredMachine = this.configureMachine();

    this.logger.log('Orchestration machine pre-configured at startup', {
      retryConfig: this.machineConfig.retry,
      timeouts: this.machineConfig.timeouts,
    });
  }

  /**
   * Build machine configuration from environment variables
   *
   * Executed once at module initialization instead of per-request.
   * All values are validated by Zod schema at app startup.
   */
  private buildMachineConfig(): OrchestrationMachineConfig {
    return {
      timeouts: {
        total: this.configService.get('APP_ORCHESTRATION_TIMEOUT', { infer: true }),
        perService: this.configService.get('APP_EXTERNAL_API_TIMEOUT', { infer: true }),
      },
      retry: {
        gus: {
          maxRetries: this.configService.get('GUS_MAX_RETRIES', { infer: true }),
          initialDelay: this.configService.get('GUS_INITIAL_DELAY', { infer: true }),
        },
        krs: {
          maxRetries: this.configService.get('KRS_MAX_RETRIES', { infer: true }),
          initialDelay: this.configService.get('KRS_INITIAL_DELAY', { infer: true }),
        },
        ceidg: {
          maxRetries: this.configService.get('CEIDG_MAX_RETRIES', { infer: true }),
          initialDelay: this.configService.get('CEIDG_INITIAL_DELAY', { infer: true }),
        },
      },
    };
  }

  /**
   * Configure orchestration machine with all actors
   *
   * Executed once at module initialization instead of per-request.
   * Actors are defined as closures that capture service dependencies
   * but receive correlationId dynamically from input (not closure).
   *
   * Key difference from previous implementation:
   * - Before: correlationId captured in closure (per-request scope)
   * - After: correlationId passed via input (request-specific data)
   * - Config: Uses this.machineConfig (pre-built at startup)
   */
  private configureMachine() {
    return this.baseMachine.provide({
      actors: {
        // GUS Classification with retry logic via factory
        retryGusClassification: createRetryActor({
          strategyName: this.gusRetryStrategy.name,
          retryStrategy: this.gusRetryStrategy,
          retryConfig: this.machineConfig.retry.gus,
          logger: this.logger,
          serviceCall: (ctx) => this.gusService.getClassificationByNip(ctx.nip!, ctx.correlationId),
        }),

        // GUS Detailed Data with retry logic via factory
        retryGusDetailedData: createRetryActor({
          strategyName: this.gusRetryStrategy.name,
          retryStrategy: this.gusRetryStrategy,
          retryConfig: this.machineConfig.retry.gus,
          logger: this.logger,
          serviceCall: (ctx) =>
            this.gusService.getDetailedReport(ctx.regon!, ctx.silosId!, ctx.correlationId),
        }),

        // KRS Data with retry logic via factory
        retryKrsData: createRetryActor({
          strategyName: this.krsRetryStrategy.name,
          retryStrategy: this.krsRetryStrategy,
          retryConfig: this.machineConfig.retry.krs,
          logger: this.logger,
          serviceCall: (ctx) =>
            this.krsService.fetchFromRegistry(ctx.krsNumber!, ctx.registry!, ctx.correlationId),
        }),

        // CEIDG Data with retry logic via factory
        retryCeidgData: createRetryActor({
          strategyName: this.ceidgRetryStrategy.name,
          retryStrategy: this.ceidgRetryStrategy,
          retryConfig: this.machineConfig.retry.ceidg,
          logger: this.logger,
          serviceCall: (ctx) => this.ceidgService.getCompanyByNip(ctx.nip!, ctx.correlationId),
        }),

        // Inactive company mapping (no retry needed)
        mapInactiveCompany: fromPromise(async ({ input }: { input: { nip: string; correlationId: string; classification: any } }) => {
          const context = input;
          this.logger.log('mapInactiveCompany started', {
            correlationId: context.correlationId,
            endDate: context.classification?.DataZakonczeniaDzialalnosci,
          });

          const mappingContext = {
            nip: context.nip,
            correlationId: context.correlationId,
            gusSessionId: this.gusService.getLastSessionId(),
            gusClassification: context.classification,
            gusDetailedData: undefined,
            krsData: undefined,
            ceidgData: undefined,
          };

          return this.unifiedDataMapper.mapToUnifiedFormat(mappingContext);
        }),

        // Unified data mapping (no retry needed)
        mapToUnifiedFormat: fromPromise(async ({ input }: { input: { nip: string; correlationId: string; classification: any; gusData?: any; krsData?: any; ceidgData?: any } }) => {
          const context = input;
          this.logger.log('mapToUnifiedFormat started', {
            correlationId: context.correlationId,
          });

          const mappingContext = {
            nip: context.nip,
            correlationId: context.correlationId,
            gusSessionId: this.gusService.getLastSessionId(),
            gusClassification: context.classification,
            gusDetailedData: context.gusData,
            krsData: context.krsData,
            ceidgData: context.ceidgData,
          };

          return this.unifiedDataMapper.mapToUnifiedFormat(mappingContext);
        }),
      },
    });
  }

  /**
   * Main entry point for company data retrieval
   * Orchestrates the complete workflow using state machine
   *
   * All exceptions are propagated to GlobalExceptionFilter which handles
   * standardization and HTTP status mapping. No error transformation here.
   */
  async getCompanyData(
    nip: string,
    correlationId: string,
  ): Promise<UnifiedCompanyData> {
    this.logger.log(
      `🚀 Starting XState orchestration machine for company data retrieval`,
      {
        nip,
        correlationId,
        architecture: 'XState-based',
      },
    );

    // Create actor from pre-configured machine (configured once at module init)
    // No per-request machine configuration overhead
    const actor = createActor(this.configuredMachine, {
      input: {
        nip,
        correlationId,
        config: this.machineConfig,
        logger: this.logger,
      },
    });
    actor.start();

    this.logger.log(`🎯 XState machine started, waiting for completion`, {
      correlationId,
    });

    const result = await this.waitForCompletion(actor, correlationId);

    this.logger.log(`✅ XState orchestration completed successfully`, {
      nip,
      correlationId,
      companyName: result.nazwa,
      dataSource: result.zrodloDanych,
      architecture: 'XState-based',
    });

    return result;
  }

  /**
   * Wait for state machine completion using XState v5 toPromise() helper
   *
   * XState v5 idiom: toPromise() waits for actor to reach final state, then we access snapshot.output.
   * The machine defines output for all final states (success, failure states).
   * Success state outputs UnifiedCompanyData, failure states output ErrorResponse.
   *
   * All exceptions (BusinessException, ZodError, etc.) are propagated to GlobalExceptionFilter
   * which handles standardization and HTTP status mapping.
   *
   * @param actor - XState actor to wait for
   * @param correlationId - Request correlation ID for logging
   * @returns UnifiedCompanyData on success
   * @throws BusinessException for failure states, ZodError for validation errors
   */
  private async waitForCompletion(
    actor: AnyActorRef,
    correlationId: string,
  ): Promise<UnifiedCompanyData> {
    // XState v5: toPromise() waits for final state, output is in snapshot.output
    await toPromise(actor);

    const snapshot = actor.getSnapshot();
    this.logger.debug('State machine completed', {
      correlationId,
      finalState: snapshot.value,
      status: snapshot.status,
    });

    // Get output from snapshot (defined by machine's output: ({ context }) => ...)
    // For success state: Use output or finalCompanyData (skip lastError)
    // For failure states: Use output or lastError
    const output = snapshot.output ??
                   (snapshot.value === 'success'
                     ? snapshot.context?.finalCompanyData
                     : snapshot.context?.lastError);

    // Check if output is an error (failure states: entityNotFoundFailure, mappingFailure, etc.)
    // ErrorResponse has 'errorCode' field, UnifiedCompanyData has 'nip' field
    // Throw BusinessException - GlobalExceptionFilter will handle it via BusinessExceptionHandler
    if (this.isErrorResponse(output)) {
      throw new BusinessException(output);
    }

    // Success state - return UnifiedCompanyData
    // Data is already validated by UnifiedDataMapper.mapToUnifiedFormat() (line 104 in unified-data.mapper.ts)
    // No need for redundant validation here - trust the validation at system boundary
    // Type assertion is safe because UnifiedDataMapper guarantees schema compliance
    return output as UnifiedCompanyData;
  }

  /**
   * Check if error has ErrorResponse structure (from XState)
   *
   * Uses lightweight duck typing for performance-critical error detection.
   * Checks only essential fields that uniquely identify ErrorResponse:
   * - errorCode: string (required, unique to errors)
   * - correlationId: string (required, unique to errors)
   *
   * Why duck typing over Zod safeParse():
   * - 10-100x faster (simple property checks vs full schema validation)
   * - Called in hot path (every state machine completion)
   * - ErrorResponse objects are controlled internally (machine failure states)
   * - No risk of false positives (UnifiedCompanyData has 'nip', not 'errorCode')
   *
   * Trade-offs:
   * - Won't catch malformed ErrorResponse objects (missing timestamp, wrong types)
   * - BUT: failure states guarantee valid ErrorResponse via convertLastErrorToErrorResponse()
   * - Schema validation happens at system boundaries, not internal orchestration
   */
  private isErrorResponse(error: unknown): error is ErrorResponse {
    return (
      typeof error === 'object' &&
      error !== null &&
      'errorCode' in error &&
      'correlationId' in error
    );
  }

  /**
   * Health check method to verify external service availability
   *
   * Always performs live checks (no caching) to ensure accurate real-time status.
   * This is critical for:
   * - Kubernetes/orchestrator health probes and routing decisions
   * - Operator diagnostics and troubleshooting
   * - System reliability monitoring
   *
   * Checks all services in parallel for faster response.
   */
  async healthCheck(): Promise<{
    status: string;
    services: Record<string, string>;
  }> {
    // Always perform live health checks - no caching
    this.logger.log('Performing live health checks for all external services');

    const [gusStatus, krsStatus, ceidgStatus] = await Promise.all([
      this.gusService.checkHealth().catch(() => 'unhealthy' as const),
      this.krsService.checkHealth().catch(() => 'unhealthy' as const),
      this.ceidgService.checkHealth().catch(() => 'unhealthy' as const),
    ]);

    const serviceStatuses: Record<string, string> = {
      gus: gusStatus,
      krs: krsStatus,
      ceidg: ceidgStatus,
    };

    const allHealthy = Object.values(serviceStatuses).every(
      (status) => status === 'healthy',
    );

    const result = {
      status: allHealthy ? 'healthy' : 'degraded',
      services: serviceStatuses,
    };

    this.logger.log('Health check completed', result);

    return result;
  }
}
