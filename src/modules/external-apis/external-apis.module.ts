import { Module } from '@nestjs/common';
import { GusService } from './gus/gus.service';
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
  imports: [],
  providers: [GusService, KrsService, CeidgV3Service],
  exports: [GusService, KrsService, CeidgV3Service],
})
export class ExternalApisModule {}
