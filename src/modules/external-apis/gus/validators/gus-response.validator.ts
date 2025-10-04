import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { createErrorResponse } from '@schemas/error-response.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';

/**
 * GUS Response Validator
 *
 * Single Responsibility: Validate GUS API responses using Zod schemas
 *
 * Responsibilities:
 * - Validate classification responses (DaneSzukajPodmioty)
 * - Validate legal person reports (BIR11OsPrawna)
 * - Validate physical person reports (BIR11OsFizycznaDzialalnoscCeidg)
 * - Convert Zod validation errors to BusinessException with ErrorResponse
 *
 * NOT responsible for:
 * - XML parsing (handled by GusResponseParser)
 * - Error detection in parsed data (handled by GusResponseParser)
 * - Generic error handling (handled by GusErrorHandler)
 */

// GUS API operation schemas for validation
export const GusClassificationResponseSchema = z.object({
  Regon: z.string().regex(/^\d{9}(\d{5})?$/),
  Nip: z.string().regex(/^\d{10}$/),
  Nazwa: z.string(),
  Typ: z.string(),
  SilosID: z.enum(['1', '2', '4', '6']),
  Wojewodztwo: z.string().optional(),
  Powiat: z.string().optional(),
  Gmina: z.string().optional(),
  Miejscowosc: z.string().optional(),
  KodPocztowy: z.string().optional(),
  Ulica: z.string().optional(),
  NrNieruchomosci: z.string().optional(),
  NrLokalu: z.string().optional(),
  DataZakonczeniaDzialalnosci: z.string().optional(),
  MiejscowoscPoczty: z.string().optional(),
});

export const GusLegalPersonReportSchema = z.object({
  praw_regon9: z.string(),
  praw_nip: z.string(),
  praw_nazwa: z.string(),
  praw_numerWRejestrzeEwidencji: z.string().optional(),
  praw_dataRozpoczeciaDzialalnosci: z.string().optional(),
  praw_dataZakonczeniaDzialalnosci: z.string().optional(),
  praw_adSiedzKodPocztowy: z.string(),
  praw_adSiedzNumerNieruchomosci: z.string().optional(),
  praw_adSiedzNumerLokalu: z.string().optional(),
  praw_adSiedzWojewodztwo_Nazwa: z.string(),
  praw_adSiedzPowiat_Nazwa: z.string().optional(),
  praw_adSiedzGmina_Nazwa: z.string().optional(),
  praw_adSiedzMiejscowosc_Nazwa: z.string(),
  praw_adSiedzUlica_Nazwa: z.string().optional(),
  praw_podstawowaFormaPrawna_Nazwa: z.string().optional(),
  praw_szczegolnaFormaPrawna_Nazwa: z.string().optional(),
});

export const GusPhysicalPersonReportSchema = z.object({
  fiz_regon9: z.string(),
  fiz_nip: z.string().optional(),
  fiz_nazwa: z.string(),
  fiz_dataRozpoczeciaDzialalnosci: z.string().optional(),
  fiz_dataZakonczeniaDzialalnosci: z.string().optional(),
  fiz_adSiedzKodPocztowy: z.string(),
  fiz_adSiedzNumerNieruchomosci: z.string().optional(),
  fiz_adSiedzNumerLokalu: z.string().optional(),
  fiz_adSiedzWojewodztwo_Nazwa: z.string(),
  fiz_adSiedzPowiat_Nazwa: z.string().optional(),
  fiz_adSiedzGmina_Nazwa: z.string().optional(),
  fiz_adSiedzMiejscowosc_Nazwa: z.string(),
  fiz_adSiedzUlica_Nazwa: z.string().optional(),
});

// Types inferred from schemas
export type GusClassificationResponse = z.infer<
  typeof GusClassificationResponseSchema
>;
export type GusLegalPersonReport = z.infer<typeof GusLegalPersonReportSchema>;
export type GusPhysicalPersonReport = z.infer<
  typeof GusPhysicalPersonReportSchema
>;

@Injectable()
export class GusResponseValidator {
  private readonly logger = new Logger(GusResponseValidator.name);

  /**
   * Validate classification response from DaneSzukajPodmioty operation
   *
   * @param data - Parsed JavaScript object
   * @param correlationId - Request correlation ID
   * @param nip - NIP used in request (for error details)
   * @returns Validated classification response
   * @throws BusinessException with GUS_VALIDATION_FAILED if validation fails
   */
  validateClassification(
    data: any,
    correlationId: string,
    nip: string,
  ): GusClassificationResponse {
    const validation = GusClassificationResponseSchema.safeParse(data);

    if (!validation.success) {
      this.logger.error(
        `GUS classification response failed schema validation`,
        {
          correlationId,
          nip,
          zodErrors: validation.error.issues,
          dataPreview: JSON.stringify(data).substring(0, 500),
        },
      );

      const errorResponse = createErrorResponse({
        errorCode: 'GUS_VALIDATION_FAILED',
        message: 'GUS classification response failed schema validation',
        correlationId,
        source: 'GUS',
        details: {
          zodErrors: validation.error.issues,
          nip,
        },
      });
      throw new BusinessException(errorResponse);
    }

    return validation.data;
  }

  /**
   * Validate legal person report from DanePobierzPelnyRaport operation
   *
   * @param data - Parsed JavaScript object
   * @param correlationId - Request correlation ID
   * @param regon - REGON used in request (for error details)
   * @param silosId - Silo ID (for error details)
   * @returns Validated legal person report
   * @throws BusinessException with GUS_VALIDATION_FAILED if validation fails
   */
  validateLegalPersonReport(
    data: any,
    correlationId: string,
    regon: string,
    silosId: string,
  ): GusLegalPersonReport {
    const validation = GusLegalPersonReportSchema.safeParse(data);

    if (!validation.success) {
      this.logger.error(
        `GUS legal person report failed schema validation`,
        {
          correlationId,
          regon,
          silosId,
          zodErrors: validation.error.issues,
          dataPreview: JSON.stringify(data).substring(0, 500),
        },
      );

      const errorResponse = createErrorResponse({
        errorCode: 'GUS_VALIDATION_FAILED',
        message: 'GUS legal person report failed schema validation',
        correlationId,
        source: 'GUS',
        details: {
          zodErrors: validation.error.issues,
          regon,
          silosId,
        },
      });
      throw new BusinessException(errorResponse);
    }

    return validation.data;
  }

  /**
   * Validate physical person report from DanePobierzPelnyRaport operation
   *
   * @param data - Parsed JavaScript object
   * @param correlationId - Request correlation ID
   * @param regon - REGON used in request (for error details)
   * @param silosId - Silo ID (for error details)
   * @returns Validated physical person report
   * @throws BusinessException with GUS_VALIDATION_FAILED if validation fails
   */
  validatePhysicalPersonReport(
    data: any,
    correlationId: string,
    regon: string,
    silosId: string,
  ): GusPhysicalPersonReport {
    const validation = GusPhysicalPersonReportSchema.safeParse(data);

    if (!validation.success) {
      this.logger.error(
        `GUS physical person report failed schema validation`,
        {
          correlationId,
          regon,
          silosId,
          zodErrors: validation.error.issues,
          dataPreview: JSON.stringify(data).substring(0, 500),
        },
      );

      const errorResponse = createErrorResponse({
        errorCode: 'GUS_VALIDATION_FAILED',
        message: 'GUS physical person report failed schema validation',
        correlationId,
        source: 'GUS',
        details: {
          zodErrors: validation.error.issues,
          regon,
          silosId,
        },
      });
      throw new BusinessException(errorResponse);
    }

    return validation.data;
  }
}
