import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheckService,
  MemoryHealthIndicator,
  HealthCheck,
} from '@nestjs/terminus';
import { OrchestrationService } from '../services/orchestration.service';
import { Public } from '@modules/common/decorators/public.decorator';

/**
 * Health Controller - System health check endpoints
 *
 * Provides endpoints for:
 * - Basic liveness check
 * - Readiness check with external service status
 * - System information
 *
 * Note: Now part of CompaniesModule to avoid circular dependency.
 * Directly depends on OrchestrationService for health checks.
 */

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
}

interface ReadinessResponse extends HealthResponse {
  services: Record<string, string>;
  dependencies: {
    gus: string;
    krs: string;
    ceidg: string;
  };
}

@ApiTags('Health')
@Controller('api/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly orchestrationService: OrchestrationService,
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Basic health check',
    description:
      'Returns basic application health status without checking external dependencies',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    type: 'HealthResponse',
  })
  getHealth(): HealthResponse {
    const uptime = Date.now() - this.startTime;

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000), // Convert to seconds
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness check',
    description:
      'Returns application readiness status including external service health',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is ready to serve requests',
    type: 'ReadinessResponse',
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready - external services unavailable',
    type: 'ReadinessResponse',
  })
  async getReadiness(): Promise<ReadinessResponse> {
    const correlationId = `health-${Date.now()}`;
    const basicHealth = this.getHealth();

    try {
      // Check external service dependencies (now async)
      const serviceCheck = await this.orchestrationService.healthCheck();

      const response: ReadinessResponse = {
        ...basicHealth,
        status: serviceCheck.status as 'healthy' | 'degraded',
        services: serviceCheck.services,
        dependencies: {
          gus: serviceCheck.services.gus || 'unknown',
          krs: serviceCheck.services.krs || 'unknown',
          ceidg: serviceCheck.services.ceidg || 'unknown',
        },
      };

      if (response.status !== 'healthy') {
        this.logger.warn('Service health check returned degraded status', {
          correlationId,
          services: response.services,
        });
      }

      return response;
    } catch (error) {
      this.logger.error('Health check failed', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...basicHealth,
        status: 'unhealthy',
        services: {
          error: 'Health check failed',
        },
        dependencies: {
          gus: 'error',
          krs: 'error',
          ceidg: 'error',
        },
      };
    }
  }

  @Public()
  @Get('live')
  @ApiOperation({
    summary: 'Liveness check',
    description: 'Simple liveness probe for container orchestration',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  getLiveness(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('metrics')
  @HealthCheck()
  @ApiOperation({
    summary: 'Application metrics with Terminus health indicators',
    description:
      'Returns standardized health metrics using @nestjs/terminus (memory, disk, etc.)',
  })
  @ApiResponse({
    status: 200,
    description: 'Application metrics',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ok', 'error'],
          description: 'Overall health status',
        },
        info: {
          type: 'object',
          description: 'Health indicators that are up',
        },
        error: {
          type: 'object',
          description: 'Health indicators that are down',
        },
        details: {
          type: 'object',
          description: 'Detailed health indicator data',
          properties: {
            memory_heap: {
              type: 'object',
              properties: {
                status: { type: 'string' },
              },
            },
            memory_rss: {
              type: 'object',
              properties: {
                status: { type: 'string' },
              },
            },
          },
        },
        uptime: { type: 'number', description: 'Uptime in seconds' },
        process: {
          type: 'object',
          properties: {
            pid: { type: 'number', description: 'Process ID' },
            nodeVersion: { type: 'string', description: 'Node.js version' },
          },
        },
      },
    },
  })
  async getMetrics() {
    const uptime = Date.now() - this.startTime;

    // Use Terminus MemoryHealthIndicator for standardized memory checks
    const healthCheckResult = await this.health.check([
      // Heap memory: 512 MB threshold (typical for Node.js applications)
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      // RSS memory: 1 GB threshold (total process memory)
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);

    // Add additional metadata not provided by Terminus
    return {
      ...healthCheckResult,
      uptime: Math.floor(uptime / 1000),
      process: {
        pid: process.pid,
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
