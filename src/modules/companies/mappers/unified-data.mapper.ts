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
import type { KrsResponse } from '@modules/external-apis/krs/krs.service';
import type { CeidgCompany } from '@modules/external-apis/ceidg/ceidg-v3.service';

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
  gusClassification?: GusClassificationResponse;
  gusDetailedData?: GusLegalPersonReport | GusPhysicalPersonReport;
  krsData?: KrsResponse;
  ceidgData?: CeidgCompany;
}

@Injectable()
export class UnifiedDataMapper {
  private readonly logger = new Logger(UnifiedDataMapper.name);

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
    };
  }

  /**
   * Map GUS-only data (fallback when KRS/CEIDG unavailable)
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

    return {
      nip,
      nazwa: this.extractGusName(gusDetailedData),
      adres: {
        miejscowosc: this.extractGusLocation(gusDetailedData),
        kodPocztowy: this.extractGusPostalCode(gusDetailedData),
        ulica: this.extractGusStreet(gusDetailedData),
        numerBudynku: this.extractGusHouseNumber(gusDetailedData),
        numerLokalu: this.extractGusApartmentNumber(gusDetailedData),
        wojewodztwo: this.extractGusProvince(gusDetailedData),
        powiat: this.extractGusDistrict(gusDetailedData),
        gmina: this.extractGusCommune(gusDetailedData),
      },
      status: this.mapStatusFromGus(gusDetailedData),
      isActive: this.isEntityActive(gusDetailedData),
      dataRozpoczeciaDzialalnosci: this.extractGusStartDate(gusDetailedData),
      dataZakonczeniaDzialalnosci: this.extractGusEndDate(gusDetailedData),
      regon: this.extractGusRegon(gusDetailedData),
      formaPrawna: this.mapLegalForm(this.extractGusLegalForm(gusDetailedData)),
      typPodmiotu: this.isLegalPerson(gusDetailedData)
        ? ('PRAWNA' as const)
        : ('FIZYCZNA' as const),
      pkd: undefined, // PKD codes not provided by this service
      zrodloDanych: 'GUS' as const,
      dataAktualizacji: new Date().toISOString(),
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
  private extractGusName(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string {
    if ('praw_nazwa' in data) return data.praw_nazwa;
    if ('fiz_nazwa' in data) return data.fiz_nazwa;
    return 'Unknown Company';
  }

  private extractGusRegon(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string {
    if ('praw_regon9' in data) return data.praw_regon9;
    if ('fiz_regon9' in data) return data.fiz_regon9;
    return '';
  }

  private extractGusLocation(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string {
    if ('praw_adSiedzMiejscowosc_Nazwa' in data)
      return data.praw_adSiedzMiejscowosc_Nazwa;
    if ('fiz_adSiedzMiejscowosc_Nazwa' in data)
      return data.fiz_adSiedzMiejscowosc_Nazwa;
    return 'Unknown';
  }

  private extractGusPostalCode(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string {
    if ('praw_adSiedzKodPocztowy' in data)
      return this.formatPostalCode(data.praw_adSiedzKodPocztowy);
    if ('fiz_adSiedzKodPocztowy' in data)
      return this.formatPostalCode(data.fiz_adSiedzKodPocztowy);
    return '00-000';
  }

  private extractGusStreet(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if ('praw_adSiedzUlica_Nazwa' in data) return data.praw_adSiedzUlica_Nazwa;
    if ('fiz_adSiedzUlica_Nazwa' in data) return data.fiz_adSiedzUlica_Nazwa;
    return undefined;
  }

  private extractGusHouseNumber(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if ('praw_adSiedzNumerNieruchomosci' in data)
      return data.praw_adSiedzNumerNieruchomosci;
    if ('fiz_adSiedzNumerNieruchomosci' in data)
      return data.fiz_adSiedzNumerNieruchomosci;
    return undefined;
  }

  private extractGusApartmentNumber(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if ('praw_adSiedzNumerLokalu' in data) return data.praw_adSiedzNumerLokalu;
    if ('fiz_adSiedzNumerLokalu' in data) return data.fiz_adSiedzNumerLokalu;
    return undefined;
  }

  private extractGusProvince(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string {
    if ('praw_adSiedzWojewodztwo_Nazwa' in data)
      return data.praw_adSiedzWojewodztwo_Nazwa.toLowerCase();
    if ('fiz_adSiedzWojewodztwo_Nazwa' in data)
      return data.fiz_adSiedzWojewodztwo_Nazwa.toLowerCase();
    return 'unknown';
  }

  private extractGusDistrict(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if ('praw_adSiedzPowiat_Nazwa' in data)
      return data.praw_adSiedzPowiat_Nazwa;
    if ('fiz_adSiedzPowiat_Nazwa' in data) return data.fiz_adSiedzPowiat_Nazwa;
    return undefined;
  }

  private extractGusCommune(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if ('praw_adSiedzGmina_Nazwa' in data) return data.praw_adSiedzGmina_Nazwa;
    if ('fiz_adSiedzGmina_Nazwa' in data) return data.fiz_adSiedzGmina_Nazwa;
    return undefined;
  }

  private extractGusStartDate(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string {
    if (
      'praw_dataRozpoczeciaDzialalnosci' in data &&
      data.praw_dataRozpoczeciaDzialalnosci
    ) {
      return this.formatDate(data.praw_dataRozpoczeciaDzialalnosci);
    }
    if (
      'fiz_dataRozpoczeciaDzialalnosci' in data &&
      data.fiz_dataRozpoczeciaDzialalnosci
    ) {
      return this.formatDate(data.fiz_dataRozpoczeciaDzialalnosci);
    }
    return new Date().toISOString().split('T')[0];
  }

  private extractGusEndDate(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): string | undefined {
    if (
      'praw_dataZakonczeniaDzialalnosci' in data &&
      data.praw_dataZakonczeniaDzialalnosci
    ) {
      return this.formatDate(data.praw_dataZakonczeniaDzialalnosci);
    }
    if (
      'fiz_dataZakonczeniaDzialalnosci' in data &&
      data.fiz_dataZakonczeniaDzialalnosci
    ) {
      return this.formatDate(data.fiz_dataZakonczeniaDzialalnosci);
    }
    return undefined;
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
    const endDate = this.extractGusEndDate(data);
    return endDate ? 'WYREJESTROWANY' : 'AKTYWNY';
  }

  private mapCeidgStatus(
    ceidgStatus: string,
  ):
    | 'AKTYWNY'
    | 'NIEAKTYWNY'
    | 'ZAWIESZONY'
    | 'WYREJESTROWANY'
    | 'W LIKWIDACJI'
    | 'UPADŁOŚĆ' {
    switch (ceidgStatus) {
      case 'AKTYWNY':
        return 'AKTYWNY';
      case 'WYKRESLONY':
        return 'WYREJESTROWANY';
      case 'ZAWIESZONY':
        return 'ZAWIESZONY';
      case 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI':
        return 'NIEAKTYWNY';
      case 'WYLACZNIE_W_FORMIE_SPOLKI':
        return 'NIEAKTYWNY';
      default:
        return 'NIEAKTYWNY';
    }
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

    const normalizedForm = gusForm.toLowerCase();
    if (
      normalizedForm.includes('spółka z ograniczoną odpowiedzialnością') ||
      normalizedForm.includes('sp. z o.o.')
    ) {
      return 'SPÓŁKA Z O.O.';
    }
    if (normalizedForm.includes('stowarzyszenie')) {
      return 'STOWARZYSZENIE';
    }
    if (normalizedForm.includes('działalność gospodarcza')) {
      return 'DZIAŁALNOŚĆ GOSPODARCZA';
    }
    return 'INNA';
  }

  /**
   * Map legal form from KRS to normalized format
   *
   * KRS provides legal form as Polish text (e.g., "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")
   * This method normalizes it to standard enum values.
   *
   * @param krsForm - Legal form string from KRS API
   * @returns Normalized legal form or 'INNA' for unknown forms
   */
  private mapKrsLegalForm(
    krsForm: string,
  ):
    | 'SPÓŁKA Z O.O.'
    | 'SPÓŁKA AKCYJNA'
    | 'PROSTA SPÓŁKA AKCYJNA'
    | 'SPÓŁKA EUROPEJSKA'
    | 'SPÓŁKA JAWNA'
    | 'SPÓŁKA PARTNERSKA'
    | 'SPÓŁKA KOMANDYTOWA'
    | 'SPÓŁKA KOMANDYTOWO-AKCYJNA'
    | 'FUNDACJA'
    | 'STOWARZYSZENIE'
    | 'DZIAŁALNOŚĆ GOSPODARCZA'
    | 'INNA' {
    const normalizedForm = krsForm.toLowerCase();

    // Spółki kapitałowe
    if (
      normalizedForm.includes('spółka z ograniczoną odpowiedzialnością') ||
      normalizedForm.includes('sp. z o.o.')
    ) {
      return 'SPÓŁKA Z O.O.';
    }
    if (
      normalizedForm.includes('spółka akcyjna') &&
      !normalizedForm.includes('prosta') &&
      !normalizedForm.includes('komandytowo')
    ) {
      return 'SPÓŁKA AKCYJNA';
    }
    if (normalizedForm.includes('prosta spółka akcyjna')) {
      return 'PROSTA SPÓŁKA AKCYJNA';
    }
    if (normalizedForm.includes('spółka europejska')) {
      return 'SPÓŁKA EUROPEJSKA';
    }

    // Spółki osobowe
    if (normalizedForm.includes('spółka jawna')) {
      return 'SPÓŁKA JAWNA';
    }
    if (normalizedForm.includes('spółka partnerska')) {
      return 'SPÓŁKA PARTNERSKA';
    }
    if (
      normalizedForm.includes('spółka komandytowa') &&
      !normalizedForm.includes('akcyjna')
    ) {
      return 'SPÓŁKA KOMANDYTOWA';
    }
    if (normalizedForm.includes('spółka komandytowo-akcyjna')) {
      return 'SPÓŁKA KOMANDYTOWO-AKCYJNA';
    }

    // Inne formy prawne
    if (normalizedForm.includes('fundacja')) {
      return 'FUNDACJA';
    }
    if (normalizedForm.includes('stowarzyszenie')) {
      return 'STOWARZYSZENIE';
    }
    if (normalizedForm.includes('działalność gospodarcza')) {
      return 'DZIAŁALNOŚĆ GOSPODARCZA';
    }

    // Nieznana forma prawna
    return 'INNA';
  }

  private isEntityActive(
    data: GusLegalPersonReport | GusPhysicalPersonReport,
  ): boolean {
    return !this.extractGusEndDate(data);
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
