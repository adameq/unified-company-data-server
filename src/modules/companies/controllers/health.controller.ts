import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Basic application metrics',
    description: 'Returns basic performance and usage metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Application metrics',
    schema: {
      type: 'object',
      properties: {
        uptime: { type: 'number', description: 'Uptime in seconds' },
        memory: {
          type: 'object',
          properties: {
            used: { type: 'number', description: 'Used memory in bytes' },
            total: { type: 'number', description: 'Total memory in bytes' },
            percentage: {
              type: 'number',
              description: 'Memory usage percentage',
            },
          },
        },
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
  getMetrics() {
    const memoryUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    return {
      uptime: Math.floor(uptime / 1000),
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: Math.round(
          (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
        ),
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
