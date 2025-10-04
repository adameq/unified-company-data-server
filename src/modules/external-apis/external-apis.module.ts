import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '@common/common.module';
import { GusService } from './gus/gus.service';
import { GusRateLimiterService } from './gus/gus-rate-limiter.service';
import { GusResponseParser } from './gus/parsers/gus-response.parser';
import { GusResponseValidator } from './gus/validators/gus-response.validator';
import { GusErrorHandler } from './gus/handlers/gus-error.handler';
import { KrsService } from './krs/krs.service';
import { CeidgV3Service } from './ceidg/ceidg-v3.service';

/**
 * External APIs Module
 *
 * Encapsulates all external API integrations:
 * - GUS (Polish Statistical Office) SOAP service
 * - KRS (Court Register) REST service
 * - CEIDG (Individual Entrepreneurs Registry) REST service
 *
 * GUS Service follows Single Responsibility Principle:
 * - GusResponseParser: XML parsing and extraction
 * - GusResponseValidator: Zod schema validation
 * - GusErrorHandler: Error conversion to ErrorResponse
 * - GusService: Orchestration facade
 *
 * All services are configured with:
 * - Retry logic and error handling
 * - Timeout configurations
 * - Structured logging
 * - Zod schema validation
 *
 * Note: Each service creates its own Axios instance with service-specific configuration
 * (KRS and CEIDG use axios.create(), GUS uses strong-soap for SOAP protocol).
 */

@Module({
  imports: [ConfigModule, CommonModule],
  providers: [
    // GUS service and dependencies (SRP refactoring)
    GusResponseParser,
    GusResponseValidator,
    GusErrorHandler,
    GusService,
    GusRateLimiterService,
    // Other external API services
    KrsService,
    CeidgV3Service,
  ],
  exports: [GusService, KrsService, CeidgV3Service],
})
export class ExternalApisModule {}
