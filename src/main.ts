import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Environment } from './config/environment.schema';
import { getHelmetConfig, getHelmetSecuritySummary } from './config/helmet.config';

async function bootstrap() {
  // Environment validation is now handled by ConfigModule.forRoot({ validate })
  // in app.module.ts, which uses the Zod schema to validate and transform values
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Environment, true>);
  const logger = new Logger('Bootstrap');

  // Enable CORS with strict origin validation
  const allowedOrigins = configService.get('CORS_ALLOWED_ORIGINS', { infer: true });
  const nodeEnv = configService.get('NODE_ENV', { infer: true });

  // Check if wildcard is configured (allows all origins)
  const allowAllOrigins = allowedOrigins.length === 1 && allowedOrigins[0] === '*';

  app.enableCors({
    // Native cors library handles origin validation:
    // - true: allows all origins (when CORS_ALLOWED_ORIGINS="*")
    // - string[]: whitelist validation with automatic rejection
    // - Automatically allows requests with no origin (mobile apps, Postman, server-to-server)
    origin: allowAllOrigins ? true : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Security warning for wildcard CORS with credentials
  if (allowAllOrigins) {
    logger.warn(
      '⚠️  SECURITY WARNING: CORS configured to allow all origins (origin: true)\n' +
        '   This combined with credentials: true creates CSRF vulnerability.\n' +
        '   Only use this in development. For production, set CORS_ALLOWED_ORIGINS to specific domains.',
    );
  }

  logger.log(`CORS enabled for environment: ${nodeEnv}`, {
    allowAllOrigins,
    allowedOrigins: allowAllOrigins ? ['*'] : allowedOrigins,
  });

  // Security middleware - Helmet with comprehensive HTTP security headers
  const helmetEnabled = configService.get('ENABLE_HELMET', { infer: true });
  const swaggerEnabled = configService.get('SWAGGER_ENABLED', { infer: true });

  if (helmetEnabled) {
    const helmetConfig = getHelmetConfig(swaggerEnabled);
    app.use(helmet(helmetConfig));

    const securitySummary = getHelmetSecuritySummary();
    logger.log('Helmet security headers enabled:', securitySummary);

    if (swaggerEnabled) {
      logger.log('Using relaxed CSP for Swagger UI (allows inline styles/scripts)');
    }
  } else {
    logger.warn('⚠️  Helmet security headers DISABLED - not recommended for production');
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false, // Collect all validation errors
      forbidUnknownValues: true,
      validateCustomDecorators: true,
      // No custom exceptionFactory - use default BadRequestException
      // GlobalExceptionFilter handles validation errors automatically
    }),
  );

  // Note: GlobalExceptionFilter is registered in AppModule as APP_FILTER
  // This ensures it works in both production and tests

  // Swagger configuration

  if (swaggerEnabled) {
    const devServerUrl = configService.get('SWAGGER_SERVER_URL_DEVELOPMENT', { infer: true });
    const prodServerUrl = configService.get('SWAGGER_SERVER_URL_PRODUCTION', { infer: true });

    const configBuilder = new DocumentBuilder()
      .setTitle('Unified Company Data Server')
      .setDescription(
        'A microservice that orchestrates data retrieval from multiple Polish government APIs (GUS, KRS, CEIDG) to provide unified company information using NIP numbers.',
      )
      .setVersion('1.0.0')
      .addTag('companies', 'Company data retrieval endpoints')
      .addTag('health', 'Health check endpoints')
      .addApiKey(
        {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description:
            'API Key in Authorization header with Bearer prefix. Format: Bearer <your-api-key>',
        },
        'API-Key-Bearer',
      )
      .addServer(devServerUrl, 'Development server');

    // Only add production server if configured
    if (prodServerUrl) {
      configBuilder.addServer(prodServerUrl, 'Production server');
    }

    const config = configBuilder.build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'Unified Company Data API Documentation',
      customfavIcon: '/favicon.ico',
      customCss: `
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info .title { color: #3b4151; }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        filter: true,
        showRequestHeaders: true,
        tryItOutEnabled: true,
      },
    });

    logger.log(`Swagger documentation enabled at /api/docs`);
  } else {
    logger.log('Swagger documentation disabled');
  }

  const port = configService.get('PORT', { infer: true });
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  if (swaggerEnabled) {
    logger.log(
      `Swagger documentation available at: http://localhost:${port}/api/docs`,
    );
  }
}

/**
 * Global error handlers for unhandled errors
 *
 * These handlers catch errors that escape the bootstrap() try-catch:
 * - Unhandled promise rejections (async errors)
 * - Uncaught exceptions (sync errors)
 *
 * All handlers exit with code 1 to signal failure to orchestration tools
 * (Docker, Kubernetes, PM2, systemd, etc.)
 */

// Handle unhandled promise rejections
// This catches async errors that weren't caught in .catch() blocks
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  const logger = new Logger('Process');
  logger.error('🚨 Unhandled Promise Rejection detected');
  logger.error(`Rejection reason: ${reason instanceof Error ? reason.message : String(reason)}`);

  if (reason instanceof Error && reason.stack) {
    logger.error(`Stack trace:\n${reason.stack}`);
  }

  logger.error('Application will terminate due to unhandled rejection');
  process.exit(1);
});

// Handle uncaught exceptions
// This catches synchronous errors that weren't caught in try-catch blocks
process.on('uncaughtException', (error: Error) => {
  const logger = new Logger('Process');
  logger.error('🚨 Uncaught Exception detected');
  logger.error(`Error: ${error.message}`);

  if (error.stack) {
    logger.error(`Stack trace:\n${error.stack}`);
  }

  logger.error('Application will terminate due to uncaught exception');
  process.exit(1);
});

/**
 * Start the application with comprehensive error handling
 *
 * This .catch() handler catches errors during bootstrap:
 * - Module initialization errors
 * - Dependency injection errors
 * - Port binding errors (EADDRINUSE)
 * - Configuration errors
 * - Swagger setup errors
 */
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');

  logger.error('💥 Fatal error during application bootstrap');

  // Extract error details
  const errorName = error instanceof Error ? error.name : 'Unknown';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  logger.error(`Error type: ${errorName}`);
  logger.error(`Error message: ${errorMessage}`);

  // Provide helpful context for common errors
  if (errorMessage.includes('EADDRINUSE')) {
    const portMatch = errorMessage.match(/port (\d+)/);
    const port = portMatch ? portMatch[1] : 'unknown';
    logger.error(`\n💡 Port ${port} is already in use. Please:`);
    logger.error(`   1. Stop the other process using this port`);
    logger.error(`   2. Or change the PORT in your .env file`);
    logger.error(`   3. Or use: lsof -ti:${port} | xargs kill -9\n`);
  }

  if (errorMessage.includes('Cannot resolve dependency') ||
      errorMessage.includes('Nest can\'t resolve dependencies')) {
    logger.error('\n💡 Dependency injection error detected. Check:');
    logger.error('   1. All required providers are registered in modules');
    logger.error('   2. All imports are correct in module definitions');
    logger.error('   3. Circular dependencies are resolved\n');
  }

  if (errorStack) {
    logger.error(`\nStack trace:\n${errorStack}`);
  }

  logger.error('\n❌ Application startup failed. Process will terminate.\n');
  process.exit(1);
});
