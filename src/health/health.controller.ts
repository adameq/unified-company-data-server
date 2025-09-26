import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'unified-company-data-server',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('detailed')
  detailedCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'unified-company-data-server',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      dependencies: {
        gus: 'not_checked', // Will be implemented later
        krs: 'not_checked', // Will be implemented later
        ceidg: 'not_checked', // Will be implemented later
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }
}
