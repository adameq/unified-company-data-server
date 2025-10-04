import { z } from 'zod';
import { validateNIP } from '@common/validators/nip.validator';

/**
 * Zod schema for standardized company information returned to API consumers
 * Based on data-model.md specification
 *
 * Source: Aggregated from external APIs (GUS, KRS, CEIDG)
 */

/**
 * REGON checksum validation removed (format validation only)
 *
 * Rationale:
 * - REGON data comes from authoritative government sources (GUS, KRS, CEIDG)
 * - These sources already validate REGON numbers before storing them
 * - Checksum validation adds unnecessary complexity and can reject valid official data
 * - Format validation (9 or 14 digits) is sufficient to catch obvious errors
 * - Trust authoritative sources for checksum correctness
 *
 * Current validation: /^\d{9}$|^\d{14}$/ (9 or 14 digits, no checksum)
 */

// PKD activity code schema
const PKDActivitySchema = z.object({
  kod: z.string().min(1, 'PKD code is required'),
  nazwa: z.string().min(1, 'PKD name is required'),
  czyGlowny: z.boolean(),
});

// Address sub-schema
const AddressSchema = z.object({
  ulica: z.string().nullable().optional().describe('Street name'),
  numerBudynku: z.string().nullable().optional().describe('Building number'),
  numerLokalu: z.string().nullable().optional().describe('Apartment/office number'),
  miejscowosc: z.string().describe('City (required)'),
  kodPocztowy: z
    .string()
    .regex(/^\d{2}-\d{3}$/, 'Must match Polish postal code format XX-XXX')
    .describe('Postal code (required, XX-XXX format)'),
  wojewodztwo: z.string().nullable().optional().describe('Voivodeship'),
  powiat: z.string().nullable().optional().describe('County'),
  gmina: z.string().nullable().optional().describe('Municipality'),
});

// Main UnifiedCompanyData schema
export const UnifiedCompanyDataSchema = z
  .object({
    // Core identifiers
    nazwa: z.string().min(1).describe('Company name (required)'),

    nip: z
      .string()
      .regex(/^\d{10}$/, 'Must be exactly 10 digits')
      .refine(validateNIP, 'Invalid NIP checksum')
      .describe('Tax identifier (required, 10 digits)'),

    regon: z
      .string()
      .regex(/^\d{9}$|^\d{14}$/, 'REGON must be 9 or 14 digits')
      .nullable()
      .optional()
      .describe('Statistical identifier (9 or 14 digits) - validated by GUS'),

    krs: z
      .string()
      .regex(/^\d{10}$/, 'Must be exactly 10 digits')
      .nullable()
      .optional()
      .describe('Court register number (10 digits)'),

    // Address information
    adres: AddressSchema,

    // Business status
    status: z
      .enum([
        'AKTYWNY',
        'NIEAKTYWNY',
        'ZAWIESZONY',
        'WYREJESTROWANY',
        'WYKREŚLONY',
        'W LIKWIDACJI',
        'UPADŁOŚĆ',
      ])
      .describe('Business status'),

    isActive: z
      .boolean()
      .describe('Derived from status (AKTYWNY = true, others = false)'),

    // Activity dates
    dataRozpoczeciaDzialalnosci: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
      .nullable()
      .optional()
      .describe('Start date (YYYY-MM-DD format)'),

    dataZakonczeniaDzialalnosci: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
      .nullable()
      .optional()
      .describe('End date (YYYY-MM-DD format)'),

    // Classification
    typPodmiotu: z.enum(['PRAWNA', 'FIZYCZNA']).describe('Legal entity type'),

    formaPrawna: z
      .enum([
        // Spółki kapitałowe
        'SPÓŁKA Z O.O.',
        'SPÓŁKA AKCYJNA',
        'PROSTA SPÓŁKA AKCYJNA',
        'SPÓŁKA EUROPEJSKA',
        // Spółki osobowe
        'SPÓŁKA JAWNA',
        'SPÓŁKA PARTNERSKA',
        'SPÓŁKA KOMANDYTOWA',
        'SPÓŁKA KOMANDYTOWO-AKCYJNA',
        // Inne formy prawne
        'FUNDACJA',
        'STOWARZYSZENIE',
        'DZIAŁALNOŚĆ GOSPODARCZA',
        'INNA',
      ])
      .nullable()
      .optional()
      .describe('Legal form (normalized from KRS, CEIDG, or GUS)'),

    // PKD activities
    pkd: z.array(PKDActivitySchema).nullable().optional().describe('PKD activity codes'),

    // Metadata
    zrodloDanych: z
      .enum(['KRS', 'CEIDG', 'GUS'])
      .describe('Primary data source'),

    dataAktualizacji: z
      .string()
      .datetime('Invalid ISO datetime format')
      .describe('Last update timestamp'),
  })
  .refine(
    (data) => {
      // Validate that isActive matches status
      const activeStatus = data.status === 'AKTYWNY';
      return data.isActive === activeStatus;
    },
    {
      message:
        'isActive field must match status (AKTYWNY = true, others = false)',
      path: ['isActive'],
    },
  )
  .refine(
    (data) => {
      // Validate that end date is after start date if both present
      if (
        data.dataRozpoczeciaDzialalnosci &&
        data.dataZakonczeniaDzialalnosci
      ) {
        const startDate = new Date(data.dataRozpoczeciaDzialalnosci);
        const endDate = new Date(data.dataZakonczeniaDzialalnosci);
        return endDate >= startDate;
      }
      return true;
    },
    {
      message: 'End date must be after or equal to start date',
      path: ['dataZakonczeniaDzialalnosci'],
    },
  )
  .refine(
    (data) => {
      // Validate KRS number based on data source
      // KRS is REQUIRED when data comes from KRS source (regardless of status)
      // For GUS/CEIDG data: KRS is OPTIONAL (negative data, not an error)
      //
      // Rationale:
      // - If data comes from KRS API, we always have KRS number (it's the lookup key)
      // - This applies to all statuses: AKTYWNY, W LIKWIDACJI, UPADŁOŚĆ, WYKREŚLONY
      // - GUS may not always have KRS number for legal entities (negative data scenario)
      // - CEIDG entities are individuals, not legal entities with KRS
      if (data.zrodloDanych === 'KRS') {
        return (
          data.krs !== undefined &&
          data.krs !== null &&
          /^\d{10}$/.test(data.krs)
        );
      }
      // For GUS/CEIDG: KRS is optional (negative data is acceptable)
      return true;
    },
    {
      message:
        'Data from KRS source must have a valid KRS number (10 digits)',
      path: ['krs'],
    },
  );

// TypeScript type inferred from schema
export type UnifiedCompanyData = z.infer<typeof UnifiedCompanyDataSchema>;

// Helper function to create UnifiedCompanyData with automatic isActive calculation
export function createUnifiedCompanyData(
  input: Omit<UnifiedCompanyData, 'isActive'> & { isActive?: boolean },
): UnifiedCompanyData {
  const isActive = input.status === 'AKTYWNY';

  return UnifiedCompanyDataSchema.parse({
    ...input,
    isActive,
  });
}

// Validation helper functions
export function validateUnifiedCompanyData(data: unknown): UnifiedCompanyData {
  return UnifiedCompanyDataSchema.parse(data);
}

export function isValidUnifiedCompanyData(
  data: unknown,
): data is UnifiedCompanyData {
  return UnifiedCompanyDataSchema.safeParse(data).success;
}

// Address validation helper
export function validateAddress(
  address: unknown,
): z.infer<typeof AddressSchema> {
  return AddressSchema.parse(address);
}

// Export address schema for reuse
export { AddressSchema, PKDActivitySchema };

// Export additional types
export type PKDActivity = z.infer<typeof PKDActivitySchema>;
