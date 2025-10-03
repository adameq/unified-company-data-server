import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createActor, fromPromise, toPromise } from 'xstate';
import { z } from 'zod';
import { UnifiedCompanyDataSchema } from '../../../schemas/unified-company-data.schema';
import {
  createErrorResponse,
  type ErrorResponse,
} from '../../../schemas/error-response.schema';
import { GusService } from '../../external-apis/gus/gus.service';
import { KrsService } from '../../external-apis/krs/krs.service';
import { CeidgV3Service } from '../../external-apis/ceidg/ceidg-v3.service';
import { UnifiedDataMapper } from '../mappers/unified-data.mapper';
import { BusinessException } from '../../../common/exceptions/business-exceptions';
import type { Environment } from '../../../config/environment.schema';
import {
  ORCHESTRATION_MACHINE,
  type OrchestrationMachineConfig,
} from '../providers/orchestration-machine.provider';
import { createRetryMachine } from '../state-machines/retry.machine';

/**
 * Orchestration Service - Bridge between Controllers and State Machines
 *
 * Responsibilities:
 * - Initialize and manage orchestration state machine
 * - Inject external service dependencies via machine.provide()
 * - Handle state machine execution and error propagation
 * - Convert state machine results to controller responses
 * - Provide correlation tracking throughout the workflow
 * - Provide health check functionality for external service monitoring
 *
 * Architecture:
 * - Uses XState v5 setup() + provide() pattern for dependency injection
 * - Base machine injected via ORCHESTRATION_MACHINE token
 * - Concrete service implementations injected via machine.provide()
 * - Eliminates Service Locator anti-pattern
 */

type UnifiedCompanyData = z.infer<typeof UnifiedCompanyDataSchema>;

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    @Inject(ORCHESTRATION_MACHINE) private readonly baseMachine: any,
    private readonly gusService: GusService,
    private readonly krsService: KrsService,
    private readonly ceidgService: CeidgV3Service,
    private readonly unifiedDataMapper: UnifiedDataMapper,
    private readonly configService: ConfigService<Environment, true>,
  ) {
    this.logger.log('OrchestrationService initialized', {
      architecture: 'XState v5 with DI',
      healthCheckStrategy: 'live (no caching)',
    });
  }

  /**
   * Main entry point for company data retrieval
   * Orchestrates the complete workflow using state machine
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

    try {
      // Build machine configuration from ConfigService
      // ConfigService returns correctly typed numbers (validated by Zod schema at app startup)
      const config: OrchestrationMachineConfig = {
        timeouts: {
          total: this.configService.get('ORCHESTRATION_TIMEOUT', { infer: true }),
          perService: this.configService.get('EXTERNAL_API_TIMEOUT', { infer: true }),
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

      this.logger.log(`🔄 Configuring XState orchestration machine with DI`, {
        correlationId,
        architecture: 'XState v5 setup() + nested provide()',
      });

      // Use fromPromise to wrap retry machines for proper orchestration compatibility
      // Pattern: fromPromise runs retry state machine actor and returns its result as a promise
      const configuredMachine = this.baseMachine.provide({
        actors: {
          // GUS Classification with retry logic via state machine
          retryGusClassification: fromPromise(async ({ input }: any) => {
            const retryMachine = createRetryMachine('GUS', correlationId, this.logger, config.retry.gus).provide({
              actors: {
                makeApiRequest: fromPromise(async ({ input: actorInput }: any) => {
                  const { context: retryContext } = actorInput;
                  const nip = (retryContext as any).nip;
                  const correlationId = retryContext.correlationId;
                  return this.gusService.getClassificationByNip(nip, correlationId);
                }),
              },
            });

            const actor = createActor(retryMachine, { input });

            return new Promise((resolve, reject) => {
              actor.subscribe({
                complete: () => {
                  const snapshot = actor.getSnapshot();
                  if (snapshot.value === 'success') {
                    resolve(snapshot.output ?? snapshot.context?.result);
                  } else {
                    reject(snapshot.output || snapshot.context?.lastError || new Error('GUS retry failed'));
                  }
                },
                error: (err) => reject(err),
              });
              actor.start();
            });
          }),

          // GUS Detailed Data with retry logic via state machine
          retryGusDetailedData: fromPromise(async ({ input }: any) => {
            const retryMachine = createRetryMachine('GUS', correlationId, this.logger, config.retry.gus).provide({
              actors: {
                makeApiRequest: fromPromise(async ({ input: actorInput }: any) => {
                  const { context: retryContext } = actorInput;
                  return this.gusService.getDetailedReport(
                    (retryContext as any).regon,
                    (retryContext as any).silosId,
                    retryContext.correlationId
                  );
                }),
              },
            });

            const actor = createActor(retryMachine, { input });

            return new Promise((resolve, reject) => {
              actor.subscribe({
                complete: () => {
                  const snapshot = actor.getSnapshot();
                  if (snapshot.value === 'success') {
                    resolve(snapshot.output ?? snapshot.context?.result);
                  } else {
                    reject(snapshot.output || snapshot.context?.lastError || new Error('GUS detailed data retry failed'));
                  }
                },
                error: (err) => reject(err),
              });
              actor.start();
            });
          }),

          // KRS Data with retry logic via state machine
          retryKrsData: fromPromise(async ({ input }: any) => {
            const retryMachine = createRetryMachine('KRS', correlationId, this.logger, config.retry.krs).provide({
              actors: {
                makeApiRequest: fromPromise(async ({ input: actorInput }: any) => {
                  const { context: retryContext } = actorInput;
                  return this.krsService.fetchFromRegistry(
                    (retryContext as any).krsNumber,
                    (retryContext as any).registry,
                    retryContext.correlationId
                  );
                }),
              },
            });

            const actor = createActor(retryMachine, { input });

            return new Promise((resolve, reject) => {
              actor.subscribe({
                complete: () => {
                  const snapshot = actor.getSnapshot();
                  if (snapshot.value === 'success') {
                    resolve(snapshot.output ?? snapshot.context?.result);
                  } else {
                    reject(snapshot.output || snapshot.context?.lastError || new Error('KRS retry failed'));
                  }
                },
                error: (err) => reject(err),
              });
              actor.start();
            });
          }),

          // CEIDG Data with retry logic via state machine
          retryCeidgData: fromPromise(async ({ input }: any) => {
            const retryMachine = createRetryMachine('CEIDG', correlationId, this.logger, config.retry.ceidg).provide({
              actors: {
                makeApiRequest: fromPromise(async ({ input: actorInput }: any) => {
                  const { context: retryContext } = actorInput;
                  return this.ceidgService.getCompanyByNip(
                    (retryContext as any).nip,
                    retryContext.correlationId
                  );
                }),
              },
            });

            const actor = createActor(retryMachine, { input });

            return new Promise((resolve, reject) => {
              actor.subscribe({
                complete: () => {
                  const snapshot = actor.getSnapshot();
                  if (snapshot.value === 'success') {
                    resolve(snapshot.output ?? snapshot.context?.result);
                  } else {
                    reject(snapshot.output || snapshot.context?.lastError || new Error('CEIDG retry failed'));
                  }
                },
                error: (err) => reject(err),
              });
              actor.start();
            });
          }),

          // Inactive company mapping (no retry needed)
          mapInactiveCompany: fromPromise(async ({ input }: any) => {
            const context = input;
            this.logger.log('mapInactiveCompany started', {
              correlationId: context.correlationId,
              endDate: context.classification?.DataZakonczeniaDzialalnosci,
            });

            const mappingContext = {
              nip: context.nip,
              correlationId: context.correlationId,
              gusClassification: context.classification,
              gusDetailedData: undefined,
              krsData: undefined,
              ceidgData: undefined,
            };

            return this.unifiedDataMapper.mapToUnifiedFormat(mappingContext);
          }),

          // Unified data mapping (no retry needed)
          mapToUnifiedFormat: fromPromise(async ({ input }: any) => {
            const context = input;
            this.logger.log('mapToUnifiedFormat started', {
              correlationId: context.correlationId,
            });

            const mappingContext = {
              nip: context.nip,
              correlationId: context.correlationId,
              gusClassification: context.classification,
              gusDetailedData: context.gusData,
              krsData: context.krsData,
              ceidgData: context.ceidgData,
            };

            return this.unifiedDataMapper.mapToUnifiedFormat(mappingContext);
          }),
        },
      });

      // Create actor with input (includes config and logger in context)
      const actor = createActor(configuredMachine, {
        input: {
          nip,
          correlationId,
          config,
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
    } catch (error) {
      this.logger.error(`Company data orchestration failed`, {
        nip,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // If already BusinessException (from external services), re-throw as-is
      if (error instanceof BusinessException) {
        throw error;
      }

      // If error has ErrorResponse structure (from XState), convert to BusinessException
      if (this.isErrorResponse(error)) {
        throw new BusinessException(error);
      }

      // Unknown errors - convert to standardized format
      const errorResponse = createErrorResponse({
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Orchestration failed',
        correlationId,
        source: 'INTERNAL',
      });

      throw new BusinessException(errorResponse);
    }
  }

  /**
   * Wait for state machine completion using XState v5 toPromise() helper
   * Eliminates Promise constructor anti-pattern with idiomatic XState code
   * Timeout is handled by the state machine itself via 'after' transitions
   */
  private async waitForCompletion(
    actor: {
      stop: () => void;
      subscribe: (callback: (snapshot: any) => void) => {
        unsubscribe: () => void;
      };
      getSnapshot: () => any;
    },
    correlationId: string,
  ): Promise<UnifiedCompanyData> {
    try {
      // XState v5: Use toPromise() to convert actor to promise
      // Note: toPromise() resolves with snapshot.output for success states
      // For final states that are not success, it still resolves (not rejects)
      // because the actor reaches 'done' status
      const output = await toPromise(actor);

      const snapshot = actor.getSnapshot();
      this.logger.debug('State machine completed', {
        correlationId,
        finalState: snapshot.value,
        status: snapshot.status,
      });

      // Check if we reached a success state
      if (snapshot.value !== 'success') {
        // Actor completed but not in success state (e.g., timeoutFailure, entityNotFoundFailure)
        // Extract error from output or context
        const errorOutput = snapshot.output || snapshot.context?.lastError;

        if (errorOutput && errorOutput.errorCode) {
          throw new BusinessException(errorOutput);
        }

        // Fallback for unexpected final states
        throw new BusinessException(
          createErrorResponse({
            errorCode: 'ORCHESTRATION_FAILED',
            message: 'Orchestration failed with unknown error',
            correlationId,
            source: 'INTERNAL',
            details: { finalState: snapshot.value },
          }),
        );
      }

      // Success state - get data from context.finalCompanyData (XState v5 output evaluation issue)
      const finalData = snapshot.context?.finalCompanyData;

      if (!finalData) {
        this.logger.error('No data in success state', {
          correlationId,
          hasOutput: !!output,
          hasContextFinal: !!snapshot.context?.finalCompanyData,
          snapshotValue: snapshot.value,
        });

        throw new BusinessException(
          createErrorResponse({
            errorCode: 'DATA_MAPPING_FAILED',
            message: 'No data in success state output',
            correlationId,
            source: 'INTERNAL',
          }),
        );
      }

      // Validate output with Zod schema
      try {
        return UnifiedCompanyDataSchema.parse(finalData);
      } catch (validationError) {
        this.logger.error('Output validation failed', {
          correlationId,
          validationError:
            validationError instanceof Error
              ? validationError.message
              : String(validationError),
        });

        throw new BusinessException(
          createErrorResponse({
            errorCode: 'DATA_MAPPING_FAILED',
            message: 'Failed to validate unified company data',
            correlationId,
            source: 'INTERNAL',
            details: {
              validationError:
                validationError instanceof Error
                  ? validationError.message
                  : String(validationError),
            },
          }),
        );
      }
    } catch (error) {
      // Handle errors from validation or BusinessException throws above
      if (error instanceof BusinessException) {
        throw error;
      }

      // Handle unexpected toPromise() rejections (should not happen in normal flow)
      const snapshot = actor.getSnapshot();

      this.logger.error('Unexpected error in waitForCompletion', {
        correlationId,
        finalState: snapshot.value,
        status: snapshot.status,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new BusinessException(
        createErrorResponse({
          errorCode: 'ORCHESTRATION_FAILED',
          message: error instanceof Error ? error.message : 'Orchestration failed with unknown error',
          correlationId,
          source: 'INTERNAL',
          details: { finalState: snapshot.value },
        }),
      );
    }
  }

  /**
   * Check if error has ErrorResponse structure (from XState)
   */
  private isErrorResponse(error: unknown): error is ErrorResponse {
    return (
      typeof error === 'object' &&
      error !== null &&
      'errorCode' in error &&
      'message' in error &&
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
