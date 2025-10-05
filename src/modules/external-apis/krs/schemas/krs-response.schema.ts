import { z } from 'zod';

/**
 * KRS Response Schemas
 *
 * Single Responsibility: Define and export all KRS API response schemas
 *
 * This file contains:
 * - Zod schemas for KRS API responses
 * - Type definitions inferred from schemas
 * - No business logic, validation, or mapping
 *
 * Pattern: Follows GUS module structure (validators/gus-response.validator.ts)
 */

// Address schema for KRS entities
export const KrsAddressSchema = z.object({
  kodPocztowy: z.string().regex(/^\d{2}-\d{3}$/),
  miejscowosc: z.string(),
  ulica: z.string().optional(),
  nrDomu: z.string().optional(),
  nrLokalu: z.string().optional(),
});

// Basic entity data schema
export const KrsEntityDataSchema = z.object({
  formaPrawna: z.string(),
  identyfikatory: z.object({
    nip: z.string().regex(/^\d{10}$/),
    regon: z.string(),
  }),
  nazwa: z.string(),
  dataWykreslenia: z.string().nullable().optional(),
  czyPosiadaStatusOPP: z.boolean().optional(),
});

// Seat and address schema
export const KrsSeatAddressSchema = z.object({
  siedziba: z.object({
    kraj: z.string(),
    wojewodztwo: z.string(),
    powiat: z.string(),
    gmina: z.string(),
    miejscowosc: z.string(),
  }),
  adres: KrsAddressSchema,
});

// Partner/shareholder schema
export const KrsPartnerSchema = z.object({
  nazwa: z.string(),
  adres: z.string(),
});

// Section 1 schema (basic entity data)
export const KrsSection1Schema = z.object({
  danePodmiotu: KrsEntityDataSchema,
  siedzibaIAdres: KrsSeatAddressSchema.optional(),
});

// Section 2 schema (partners/shareholders)
export const KrsSection2Schema = z.object({
  wspolnicy: z.array(KrsPartnerSchema).optional(),
});

// Liquidation schema (Dzial 6)
export const KrsLiquidationSchema = z
  .object({
    dataRozpoczecia: z.string().optional(),
    // Other fields exist but we only need to detect presence
  })
  .passthrough(); // Allow additional fields we don't need to validate

// Bankruptcy schema (Dzial 6)
export const KrsBankruptcySchema = z
  .object({
    dataPostanowienia: z.string().optional(),
    // Other fields exist but we only need to detect presence
  })
  .passthrough();

// Section 6 schema (bankruptcy and liquidation status)
export const KrsSection6Schema = z
  .object({
    likwidacja: z.array(KrsLiquidationSchema).optional(),
    postepowanieUpadlosciowe: z.array(KrsBankruptcySchema).optional(),
  })
  .optional();

// Complete KRS data schema
export const KrsDataSchema = z.object({
  dzial1: KrsSection1Schema,
  dzial2: KrsSection2Schema.optional(),
  dzial6: KrsSection6Schema.optional(),
});

// Header schema (registry metadata)
export const KrsHeaderSchema = z.object({
  rejestr: z.string(),
  numerKRS: z.string(),
  stanZDnia: z.string(),
  dataRejestracjiWKRS: z.string().optional(),
  stanPozycji: z.number().optional(), // Entity status: 1=active, 3=deleted but visible, 4=deleted
});

// Complete KRS response schema
export const KrsResponseSchema = z.object({
  odpis: z.object({
    rodzaj: z.string(),
    dane: KrsDataSchema,
    naglowekA: KrsHeaderSchema,
  }),
});

// Exported types inferred from schemas
export type KrsResponse = z.infer<typeof KrsResponseSchema>;
export type KrsEntityData = z.infer<typeof KrsEntityDataSchema>;
export type KrsAddress = z.infer<typeof KrsAddressSchema>;
