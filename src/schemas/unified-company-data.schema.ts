import { z } from 'zod';

/**
 * Zod schema for standardized company information returned to API consumers
 * Based on data-model.md specification
 *
 * Source: Aggregated from external APIs (GUS, KRS, CEIDG)
 */

// Address sub-schema
const AddressSchema = z.object({
  ulica: z.string().optional().describe('Street name'),
  numerBudynku: z.string().optional().describe('Building number'),
  numerLokalu: z.string().optional().describe('Apartment/office number'),
  miejscowosc: z.string().describe('City (required)'),
  kodPocztowy: z
    .string()
    .regex(/^\d{2}-\d{3}$/, 'Must match Polish postal code format XX-XXX')
    .describe('Postal code (required, XX-XXX format)'),
  wojewodztwo: z.string().optional().describe('Voivodeship'),
  powiat: z.string().optional().describe('County'),
  gmina: z.string().optional().describe('Municipality'),
});

// Main UnifiedCompanyData schema
export const UnifiedCompanyDataSchema = z
  .object({
    // Core identifiers
    nazwa: z.string().min(1).describe('Company name (required)'),

    nip: z
      .string()
      .regex(/^\d{10}$/, 'Must be exactly 10 digits')
      .describe('Tax identifier (required, 10 digits)'),

    regon: z
      .string()
      .regex(/^\d{9}(\d{5})?$/, 'Must be 9 or 14 digits')
      .optional()
      .describe('Statistical identifier (9 or 14 digits)'),

    krs: z
      .string()
      .regex(/^\d{10}$/, 'Must be exactly 10 digits')
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
      .optional()
      .describe('Start date (YYYY-MM-DD format)'),

    dataZakonczeniaDzialalnosci: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
      .optional()
      .describe('End date (YYYY-MM-DD format)'),

    // Classification
    typPodmiotu: z.enum(['PRAWNA', 'FIZYCZNA']).describe('Legal entity type'),

    formaPrawna: z
      .enum([
        'SPÓŁKA Z O.O.',
        'STOWARZYSZENIE',
        'DZIAŁALNOŚĆ GOSPODARCZA',
        'INNA',
      ])
      .optional()
      .describe('Legal form'),

    // Metadata
    zrodloDanych: z
      .enum(['KRS', 'CEIDG', 'GUS'])
      .describe('Primary data source'),
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
      // Validate that legal entities (PRAWNA) have KRS number
      if (data.typPodmiotu === 'PRAWNA') {
        return data.krs !== undefined && data.krs.length === 10;
      }
      return true;
    },
    {
      message: 'Legal entities (PRAWNA) must have a valid KRS number',
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
export { AddressSchema };
