import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { UnifiedCompanyDataSchema } from '@schemas/unified-company-data.schema';
import { createErrorResponse } from '@schemas/error-response.schema';
import { BusinessException } from '@common/exceptions/business-exceptions';
import type {
  GusClassificationResponse,
  GusLegalPersonReport,
  GusPhysicalPersonReport,
} from '@modules/external-apis/gus/gus.service';
import type { KrsResponse } from '@modules/external-apis/krs/schemas/krs-response.schema';
import type { CeidgCompany } from '@modules/external-apis/ceidg/schemas/ceidg-response.schema';

/**
 * Unified Data Mapper Service
 *
 * Responsible for mapping data from various external APIs (GUS, KRS, CEIDG)
 * to the unified company data format used throughout the application.
 *
 * Key responsibilities:
 * - Data transformation from external API formats
 * - Data source priority handling (KRS > CEIDG > GUS)
 * - Field mapping and normalization
 * - Address standardization
 * - PKD code handling
 * - Data validation with Zod schemas
 */

type UnifiedCompanyData = z.infer<typeof UnifiedCompanyDataSchema>;

export interface MappingContext {
  nip: string;
  correlationId: string;
  gusSessionId?: string;
  gusClassification?: GusClassificationResponse;
  gusDetailedData?: GusLegalPersonReport | GusPhysicalPersonReport;
  krsData?: KrsResponse;
  ceidgData?: CeidgCompany;
}

@Injectable()
export class UnifiedDataMapper {
  private readonly logger = new Logger(UnifiedDataMapper.name);

  // Configuration-driven field extraction for GUS data
  private readonly GUS_FIELD_CONFIG = {
    nazwa: { fieldName: 'nazwa', defaultValue: 'Unknown Company' },
    regon: { fieldName: 'regon9', defaultValue: '' },
    miejscowosc: { fieldName: 'adSiedzMiejscowosc_Nazwa', defaultValue: 'Unknown' },
    kodPocztowy: {
      fieldName: 'adSiedzKodPocztowy',
      defaultValue: '00-000',
      transform: (v: string) => this.formatPostalCode(v),
    },
    ulica: { fieldName: 'adSiedzUlica_Nazwa', defaultValue: undefined },
    numerBudynku: { fieldName: 'adSiedzNumerNieruchomosci', defaultValue: undefined },
    numerLokalu: { fieldName: 'adSiedzNumerLokalu', defaultValue: undefined },
    wojewodztwo: {
      fieldName: 'adSiedzWojewodztwo_Nazwa',
      defaultValue: 'unknown',
      transform: (v: string) => v.toLowerCase(),
    },
    powiat: { fieldName: 'adSiedzPowiat_Nazwa', defaultValue: undefined },
    gmina: { fieldName: 'adSiedzGmina_Nazwa', defaultValue: undefined },
    dataRozpoczecia: {
      fieldName: 'dataRozpoczeciaDzialalnosci',
      defaultValue: new Date().toISOString().split('T')[0],
      transform: (v: string) => this.formatDate(v),
      requireTruthy: true,
    },
    dataZakonczenia: {
      fieldName: 'dataZakonczeniaDzialalnosci',
      defaultValue: undefined,
      transform: (v: string) => this.formatDate(v),
      requireTruthy: true,
    },
  } as const;

  // Map-based CEIDG status mapping (direct key-value)
  private readonly CEIDG_STATUS_MAP = new Map<string, UnifiedCompanyData['status']>([
    ['AKTYWNY', 'AKTYWNY'],
    ['WYKRESLONY', 'WYREJESTROWANY'],
    ['ZAWIESZONY', 'ZAWIESZONY'],
    ['OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI', 'NIEAKTYWNY'],
    ['WYLACZNIE_W_FORMIE_SPOLKI', 'NIEAKTYWNY'],
  ]);

  // Ordered pattern matching for KRS legal forms (order matters!)
  private readonly KRS_LEGAL_FORM_PATTERNS = [
    // Capital companies (spółki kapitałowe) - check specific forms first
    { pattern: /prosta spółka akcyjna/i, form: 'PROSTA SPÓŁKA AKCYJNA' as const },
    { pattern: /spółka komandytowo-akcyjna/i, form: 'SPÓŁKA KOMANDYTOWO-AKCYJNA' as const },
    { pattern: /spółka akcyjna/i, form: 'SPÓŁKA AKCYJNA' as const },
    { pattern: /(spółka z ograniczoną odpowiedzialnością|sp\. z o\.o\.)/i, form: 'SPÓŁKA Z O.O.' as const },
    { pattern: /spółka europejska/i, form: 'SPÓŁKA EUROPEJSKA' as const },

    // Partnerships (spółki osobowe)
    { pattern: /spółka jawna/i, form: 'SPÓŁKA JAWNA' as const },
    { pattern: /spółka partnerska/i, form: 'SPÓŁKA PARTNERSKA' as const },
    { pattern: /spółka komandytowa/i, form: 'SPÓŁKA KOMANDYTOWA' as const },

    // Other entities
    { pattern: /fundacja/i, form: 'FUNDACJA' as const },
    { pattern: /stowarzyszenie/i, form: 'STOWARZYSZENIE' as const },
    { pattern: /działalność gospodarcza/i, form: 'DZIAŁALNOŚĆ GOSPODARCZA' as const },
  ] as const;

  // Ordered pattern matching for GUS legal forms
  private readonly GUS_LEGAL_FORM_PATTERNS = [
    { pattern: /(spółka z ograniczoną odpowiedzialnością|sp\. z o\.o\.)/i, form: 'SPÓŁKA Z O.O.' as const },
    { pattern: /stowarzyszenie/i, form: 'STOWARZYSZENIE' as const },
    { pattern: /działalność gospodarcza/i, form: 'DZIAŁALNOŚĆ GOSPODARCZA' as const },
  ] as const;

  /**
   * Main entry point for mapping all available data sources to unified format
   */
  mapToUnifiedFormat(context: MappingContext): UnifiedCompanyData {
    this.logger.log('Starting data mapping to unified format', {
      correlationId: context.correlationId,
      nip: context.nip,
      sources: this.getAvailableSources(context),
    });

    try {
      // Special case: Inactive company with only classification data
      if (
        context.gusClassification?.DataZakonczeniaDzialalnosci &&
        !context.gusDetailedData &&
        !context.krsData &&
        !context.ceidgData
      ) {
        this.logger.log('Mapping inactive company from classification only', {
          correlationId: context.correlationId,
          endDate: context.gusClassification.DataZakonczeniaDzialalnosci,
        });
        return this.mapInactiveCompanyFromClassification(context);
      }

      // Determine primary data source and map accordingly
      const dataSource = this.determineDataSource(context);

      let unifiedData: UnifiedCompanyData;

      switch (dataSource) {
        case 'KRS':
          unifiedData = this.mapKrsOnlyData(context);
          break;
        case 'CEIDG':
          unifiedData = this.mapCeidgOnlyData(context);
          break;
        case 'GUS':
          unifiedData = this.mapGusOnlyData(context);
          break;
        default:
          throw new BusinessException({
            errorCode: 'INTERNAL_SERVER_ERROR',
            message: 'Internal error: Unsupported data source combination',
            correlationId: context.correlationId,
            source: 'INTERNAL',
            details: { dataSource },
          });
      }

      // Debug logging before validation
      this.logger.log('Data before validation', {
        correlationId: context.correlationId,
        typPodmiotu: unifiedData.typPodmiotu,
        krs: unifiedData.krs,
        krsLength: unifiedData.krs?.length,
        krsType: typeof unifiedData.krs,
      });

      // Validate the result against schema
      const validatedData = UnifiedCompanyDataSchema.parse(unifiedData);

      this.logger.log('Data mapping completed successfully', {
        correlationId: context.correlationId,
        nip: context.nip,
        dataSource: validatedData.zrodloDanych,
        companyName: validatedData.nazwa,
      });

      return validatedData;
    } catch (error) {
      // ZodError: Rethrow to allow ZodErrorHandler to process (preserves validation context)
      if (error instanceof z.ZodError) {
        this.logger.error('Data validation failed (ZodError)', {
          correlationId: context.correlationId,
          nip: context.nip,
          validationIssues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        throw error; // Let ZodErrorHandler handle it
      }

      // Other errors: Wrap in BusinessException with DATA_MAPPING_FAILED
      this.logger.error('Data mapping failed', {
        correlationId: context.correlationId,
        nip: context.nip,
        error: error instanceof Error ? error.message : String(error),
      });

      const errorResponse = createErrorResponse({
        errorCode: 'DATA_MAPPING_FAILED',
        message: 'Failed to map external API data to unified format',
        correlationId: context.correlationId,
        source: 'INTERNAL',
        details: {
          nip: context.nip,
          availableSources: this.getAvailableSources(context),
          originalError: error instanceof Error ? error.message : String(error),
        },
      });

      // Throw BusinessException instead of Error with properties
      throw new BusinessException(errorResponse);
    }
  }

  /**
   * Map inactive company from classification data only
   * Used for companies with DataZakonczeniaDzialalnosci (ended operations)
   * to avoid unnecessary API calls
   */
  private mapInactiveCompanyFromClassification(
    context: MappingContext,
  ): UnifiedCompanyData {
    const { gusClassification, nip, correlationId } = context;

    if (!gusClassification) {
      throw new BusinessException({
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'Internal error: Missing GUS classification for inactive company',
        correlationId,
        source: 'INTERNAL',
        details: { nip },
      });
    }

    this.logger.log('Mapping inactive company from classification only', {
      correlationId,
      nip,
      endDate: gusClassification.DataZakonczeniaDzialalnosci,
    });

    // Determine entity type from SilosID
    const silosId = gusClassification.SilosID;
    const typPodmiotu = silosId === '6' ? 'PRAWNA' : 'FIZYCZNA';

    return {
      nip,
      nazwa: gusClassification.Nazwa,
      adres: {
        wojewodztwo: gusClassification.Wojewodztwo || '',
        powiat: gusClassification.Powiat || '',
        gmina: gusClassification.Gmina || '',
        miejscowosc: gusClassification.Miejscowosc || '',
        kodPocztowy: gusClassification.KodPocztowy || '',
        ulica: gusClassification.Ulica || undefined,
        numerBudynku: gusClassification.NrNieruchomosci || '',
        numerLokalu: gusClassification.NrLokalu || undefined,
      },
      status: 'WYKREŚLONY',
      isActive: false,
      regon: gusClassification.Regon,
      krs: undefined, // No KRS for inactive companies
      typPodmiotu,
      dataRozpoczeciaDzialalnosci: undefined, // Not available in classification
      dataZakonczeniaDzialalnosci:
        gusClassification.DataZakonczeniaDzialalnosci,
      pkd: undefined, // PKD codes not provided by this service
      formaPrawna: undefined,
      zrodloDanych: 'GUS',
      dataAktualizacji: new Date().toISOString(),
      registrySignature: context.gusSessionId
        ? `GUS sessionId ${context.gusSessionId}`
        : `GUS regon ${gusClassification.Regon}`,
    };
  }

  /**
   * Map KRS-only data (source of truth for legal entities)
   */
  private mapKrsOnlyData(context: MappingContext): UnifiedCompanyData {
    const { krsData, nip, correlationId } = context;

    if (!krsData) {
      throw new BusinessException({
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'Internal error: Missing required KRS data for mapping',
        correlationId,
        source: 'INTERNAL',
        details: { nip },
      });
    }

    const danePodmiotu = krsData.odpis.dane.dzial1.danePodmiotu;
    const krsEntity = danePodmiotu;
    const krsAddress = krsData.odpis.dane.dzial1.siedzibaIAdres?.adres;

    this.logger.log('Mapping KRS-only data (source of truth)', {
      correlationId,
      krsNumber: krsData.odpis.naglowekA.numerKRS,
    });

    const status = this.determineStatusFromKrs(krsData);
    const isActive = status === 'AKTYWNY';

    return {
      nip,
      nazwa: krsEntity.nazwa,
      adres: {
        miejscowosc: krsAddress?.miejscowosc || 'BRAK', // KRS should have this, fallback if missing
        kodPocztowy: krsAddress?.kodPocztowy || '00-000', // KRS should have this, fallback if missing
        ulica: krsAddress?.ulica ?? null,
        numerBudynku: krsAddress?.nrDomu ?? null,
        numerLokalu: krsAddress?.nrLokalu ?? null,
        wojewodztwo: null, // KRS nie zawiera
        powiat: null, // KRS nie zawiera
        gmina: null, // KRS nie zawiera
      },
      status,
      isActive,
      dataRozpoczeciaDzialalnosci: krsData.odpis.naglowekA.dataRejestracjiWKRS
        ? this.formatDate(krsData.odpis.naglowekA.dataRejestracjiWKRS)
        : null,
      dataZakonczeniaDzialalnosci: danePodmiotu.dataWykreslenia
        ? this.formatDate(danePodmiotu.dataWykreslenia)
        : null,
      regon: krsEntity.identyfikatory.regon,
      krs: krsData.odpis.naglowekA.numerKRS,
      formaPrawna: this.mapKrsLegalForm(danePodmiotu.formaPrawna),
      typPodmiotu: 'PRAWNA' as const,
      pkd: undefined, // PKD codes not provided by this service
      zrodloDanych: 'KRS' as const,
      dataAktualizacji: new Date().toISOString(),
      registrySignature: `KRS stanZDnia ${krsData.odpis.naglowekA.stanZDnia}`,
    };
  }

  /**
   * Map CEIDG-only data (source of truth for individuals)
   */
  private mapCeidgOnlyData(context: MappingContext): UnifiedCompanyData {
    const { ceidgData, nip, correlationId } = context;

    if (!ceidgData) {
      throw new BusinessException({
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'Internal error: Missing required CEIDG data for mapping',
        correlationId,
        source: 'INTERNAL',
        details: { nip },
      });
    }

    return {
      nip,
      nazwa: ceidgData.nazwa,
      adres: {
        miejscowosc: ceidgData.adresDzialalnosci.miasto,
        kodPocztowy: ceidgData.adresDzialalnosci.kod,
        ulica: ceidgData.adresDzialalnosci.ulica,
        numerBudynku: ceidgData.adresDzialalnosci.budynek,
        numerLokalu: ceidgData.adresDzialalnosci.lokal,
        wojewodztwo: ceidgData.adresDzialalnosci.wojewodztwo,
        powiat: ceidgData.adresDzialalnosci.powiat,
        gmina: ceidgData.adresDzialalnosci.gmina,
      },
      status: this.mapCeidgStatus(ceidgData.status),
      isActive: ceidgData.status === 'AKTYWNY' && !ceidgData.dataZakonczenia,
      dataRozpoczeciaDzialalnosci: ceidgData.dataRozpoczecia,
      dataZakonczeniaDzialalnosci: ceidgData.dataZakonczenia,
      regon: ceidgData.wlasciciel.regon,
      formaPrawna: 'DZIAŁALNOŚĆ GOSPODARCZA' as const,
      typPodmiotu: 'FIZYCZNA' as const,
      pkd: undefined, // PKD codes not provided by this service
      zrodloDanych: 'CEIDG' as const,
      dataAktualizacji: new Date().toISOString(),
      registrySignature: `CEIDG id ${ceidgData.id}`,
    };
  }

  /**
   * Map GUS-only data (fallback when KRS/CEIDG unavailable)
   *
   * Uses configuration-driven field extraction instead of wrapper methods
   */
  private mapGusOnlyData(context: MappingContext): UnifiedCompanyData {
    const { gusDetailedData, nip, correlationId } = context;

    if (!gusDetailedData) {
      throw new BusinessException({
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'Internal error: Missing required GUS data for mapping',
        correlationId,
        source: 'INTERNAL',
        details: { nip },
      });
    }

    const cfg = this.GUS_FIELD_CONFIG;

    return {
      nip,
      nazwa: this.extractGusField(gusDetailedData, cfg.nazwa.fieldName, cfg.nazwa.defaultValue),
      adres: {
        miejscowosc: this.extractGusField(gusDetailedData, cfg.miejscowosc.fieldName, cfg.miejscowosc.defaultValue),
        kodPocztowy: this.extractGusField(gusDetailedData, cfg.kodPocztowy.fieldName, cfg.kodPocztowy.defaultValue, cfg.kodPocztowy.transform),
        ulica: this.extractGusField(gusDetailedData, cfg.ulica.fieldName, cfg.ulica.defaultValue),
        numerBudynku: this.extractGusField(gusDetailedData, cfg.numerBudynku.fieldName, cfg.numerBudynku.defaultValue),
        numerLokalu: this.extractGusField(gusDetailedData, cfg.numerLokalu.fieldName, cfg.numerLokalu.defaultValue),
        wojewodztwo: this.extractGusField(gusDetailedData, cfg.wojewodztwo.fieldName, cfg.wojewodztwo.defaultValue, cfg.wojewodztwo.transform),
        powiat: this.extractGusField(gusDetailedData, cfg.powiat.fieldName, cfg.powiat.defaultValue),
        gmina: this.extractGusField(gusDetailedData, cfg.gmina.fieldName, cfg.gmina.defaultValue),
      },
      status: this.mapStatusFromGus(gusDetailedData),
      isActive: this.isEntityActive(gusDetailedData),
      dataRozpoczeciaDzialalnosci: this.extractGusField(
        gusDetailedData,
        cfg.dataRozpoczecia.fieldName,
        cfg.dataRozpoczecia.defaultValue,
        cfg.dataRozpoczecia.transform,
        cfg.dataRozpoczecia.requireTruthy,
      ),
      dataZakonczeniaDzialalnosci: this.extractGusField(
        gusDetailedData,
        cfg.dataZakonczenia.fieldName,
        cfg.dataZakonczenia.defaultValue,
        cfg.dataZakonczenia.transform,
        cfg.dataZakonczenia.requireTruthy,
      ),
      regon: this.extractGusField(gusDetailedData, cfg.regon.fieldName, cfg.regon.defaultValue),
      formaPrawna: this.mapLegalForm(this.extractGusLegalForm(gusDetailedData)),
      typPodmiotu: this.isLegalPerson(gusDetailedData)
        ? ('PRAWNA' as const)
        : ('FIZYCZNA' as const),
      pkd: undefined, // PKD codes not provided by this service
      zrodloDanych: 'GUS' as const,
      dataAktualizacji: new Date().toISOString(),
      registrySignature: context.gusSessionId
        ? `GUS sessionId ${context.gusSessionId}`
        : `GUS regon ${this.extractGusField(gusDetailedData, cfg.regon.fieldName, cfg.regon.defaultValue)}`,
    };
  }

  /**
   * Determine the primary data source based on available data
   */
  private determineDataSource(context: MappingContext): string {
    this.logger.log('Determining data source', {
      correlationId: context.correlationId,
      hasKrsData: !!context.krsData,
      hasGusDetailedData: !!context.gusDetailedData,
      hasCeidgData: !!context.ceidgData,
    });

    // CEIDG jako jedyne źródło prawdy (bez wzbogacania z GUS)
    if (context.ceidgData) {
      this.logger.log('Selected data source: CEIDG (source of truth)', {
        correlationId: context.correlationId,
      });
      return 'CEIDG';
    }

    // KRS jako jedyne źródło prawdy (bez wzbogacania z GUS)
    if (context.krsData) {
      this.logger.log('Selected data source: KRS (source of truth)', {
        correlationId: context.correlationId,
      });
      return 'KRS';
    }

    // GUS jako fallback
    if (context.gusDetailedData) {
      this.logger.log('Selected data source: GUS (fallback)', {
        correlationId: context.correlationId,
      });
      return 'GUS';
    }

    throw new BusinessException({
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'Internal error: No valid data sources available for mapping',
      correlationId: context.correlationId,
      source: 'INTERNAL',
      details: { nip: context.nip },
    });
  }

  /**
   * Get list of available data sources for logging
   */
  private getAvailableSources(context: MappingContext): string[] {
    const sources: string[] = [];
    if (context.gusClassification) sources.push('GUS_CLASSIFICATION');
    if (context.gusDetailedData) sources.push('GUS_DETAILED');
    if (context.krsData) sources.push('KRS');
    if (context.ceidgData) sources.push('CEIDG');
    return sources;
  }

  // GUS data extraction helpers

  /**
   * Generic helper to extract GUS field for both legal and physical persons
   *
   * Automatically checks for both praw_${fieldName} and fiz_${fieldName} variants.
   * Supports optional transformation and default values.
   *
   * @param data - GUS report data (legal or physical person)
   * @param fieldName - Base field name (without praw_/fiz_ prefix)
   * @param defaultValue - Value to return if field not found
   * @param transform - Optional transformation function (e.g., formatPostalCode, toLowerCase)
   * @param requireTruthy - Only return value if truthy (for date fields)
   * @returns Extracted field value or default
   */
  private extractGusField<T>(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
    fieldName: string,
    defaultValue: T,
    transform?: (value: string) => string,
    requireTruthy: boolean = false,
  ): T {
    // Check legal person variant (praw_)
    const prawKey = `praw_${fieldName}` as keyof typeof data;
    if (prawKey in data) {
      const value = data[prawKey] as string;
      if (requireTruthy && !value) return defaultValue;
      return (transform ? transform(value) : value) as T;
    }

    // Check physical person variant (fiz_)
    const fizKey = `fiz_${fieldName}` as keyof typeof data;
    if (fizKey in data) {
      const value = data[fizKey] as string;
      if (requireTruthy && !value) return defaultValue;
      return (transform ? transform(value) : value) as T;
    }

    return defaultValue;
  }

  private extractGusLegalForm(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if ('praw_podstawowaFormaPrawna_Nazwa' in data) {
      return (
        data.praw_podstawowaFormaPrawna_Nazwa ||
        data.praw_szczegolnaFormaPrawna_Nazwa
      );
    }
    return undefined;
  }

  private mapStatusFromGus(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ):
    | 'AKTYWNY'
    | 'NIEAKTYWNY'
    | 'ZAWIESZONY'
    | 'WYREJESTROWANY'
    | 'W LIKWIDACJI'
    | 'UPADŁOŚĆ' {
    const cfg = this.GUS_FIELD_CONFIG;
    const endDate = this.extractGusField(
      data,
      cfg.dataZakonczenia.fieldName,
      cfg.dataZakonczenia.defaultValue,
      cfg.dataZakonczenia.transform,
      cfg.dataZakonczenia.requireTruthy,
    );
    return endDate ? 'WYREJESTROWANY' : 'AKTYWNY';
  }

  private mapCeidgStatus(ceidgStatus: string): UnifiedCompanyData['status'] {
    return this.CEIDG_STATUS_MAP.get(ceidgStatus) ?? 'NIEAKTYWNY';
  }

  private mapLegalForm(
    gusForm: string | undefined,
  ):
    | 'SPÓŁKA Z O.O.'
    | 'STOWARZYSZENIE'
    | 'DZIAŁALNOŚĆ GOSPODARCZA'
    | 'INNA'
    | undefined {
    if (!gusForm) return undefined;

    // Loop through patterns in order
    for (const { pattern, form } of this.GUS_LEGAL_FORM_PATTERNS) {
      if (pattern.test(gusForm)) {
        return form;
      }
    }

    // No match found
    return 'INNA';
  }

  /**
   * Map legal form from KRS to normalized format using pattern matching
   *
   * KRS provides legal form as Polish text (e.g., "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")
   * This method normalizes it to standard enum values using ordered regex patterns.
   *
   * @param krsForm - Legal form string from KRS API
   * @returns Normalized legal form or 'INNA' for unknown forms
   */
  private mapKrsLegalForm(krsForm: string): UnifiedCompanyData['formaPrawna'] {
    // Loop through patterns in order (order matters for specific vs general forms)
    for (const { pattern, form } of this.KRS_LEGAL_FORM_PATTERNS) {
      if (pattern.test(krsForm)) {
        return form;
      }
    }

    // No match found
    return 'INNA';
  }

  private isEntityActive(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): boolean {
    const cfg = this.GUS_FIELD_CONFIG;
    return !this.extractGusField(
      data,
      cfg.dataZakonczenia.fieldName,
      cfg.dataZakonczenia.defaultValue,
      cfg.dataZakonczenia.transform,
      cfg.dataZakonczenia.requireTruthy,
    );
  }

  private isLegalPerson(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): boolean {
    return 'praw_nazwa' in data;
  }

  /**
   * Determine status from KRS data (dzial6 and dataWykreslenia)
   * Per dokumentacja.md section 3:
   * - dataWykreslenia exists → 'WYKREŚLONY'
   * - dzial6.postepowanieUpadlosciowe → 'UPADŁOŚĆ'
   * - dzial6.likwidacja → 'W LIKWIDACJI'
   * - No dzial6 or empty → 'AKTYWNY'
   *
   * NOTE: stanPozycji is NOT reliable for determining deleted status.
   * WOŚP (0000030897) has stanPozycji=3 but is active with no dataWykreslenia.
   */
  private determineStatusFromKrs(
    krsData: KrsResponse,
  ): 'AKTYWNY' | 'W LIKWIDACJI' | 'UPADŁOŚĆ' | 'WYKREŚLONY' {
    const dzial6 = krsData.odpis.dane.dzial6;
    const danePodmiotu = krsData.odpis.dane.dzial1.danePodmiotu;

    // Priority 0: Check dataWykreslenia for deleted entities (highest priority)
    // Only trust the explicit dataWykreslenia field from dzial1.danePodmiotu
    if (
      danePodmiotu.dataWykreslenia &&
      danePodmiotu.dataWykreslenia !== null &&
      danePodmiotu.dataWykreslenia.trim() !== ''
    ) {
      return 'WYKREŚLONY';
    }

    if (!dzial6 || Object.keys(dzial6).length === 0) {
      return 'AKTYWNY';
    }

    // Priority 1: Bankruptcy status (second priority)
    if (
      dzial6.postepowanieUpadlosciowe &&
      dzial6.postepowanieUpadlosciowe.length > 0
    ) {
      return 'UPADŁOŚĆ';
    }

    // Priority 2: Liquidation status (third priority)
    if (dzial6.likwidacja && dzial6.likwidacja.length > 0) {
      return 'W LIKWIDACJI';
    }

    return 'AKTYWNY';
  }

  // Utility methods
  private formatPostalCode(code: string): string {
    if (code.length === 5 && !code.includes('-')) {
      return `${code.slice(0, 2)}-${code.slice(2)}`;
    }
    return code;
  }

  private formatDate(dateString: string): string {
    // Handle various date formats from external APIs

    // Already in YYYY-MM-DD format (GUS format)
    if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return dateString;
    }

    // KRS format: DD.MM.YYYY → YYYY-MM-DD
    if (dateString.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [day, month, year] = dateString.split('.');
      return `${year}-${month}-${day}`;
    }

    // Fallback - return as is
    return dateString;
  }
}
