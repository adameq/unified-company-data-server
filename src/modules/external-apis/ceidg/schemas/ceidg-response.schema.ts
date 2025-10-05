import { z } from 'zod';

/**
 * CEIDG Response Schemas
 *
 * Single Responsibility: Define and export all CEIDG API response schemas
 *
 * This file contains:
 * - Zod schemas for CEIDG v3 API responses
 * - Type definitions inferred from schemas
 * - No business logic, validation, or mapping
 *
 * Pattern: Follows GUS module structure (validators/gus-response.validator.ts)
 */

// Address schema for CEIDG entities
export const CeidgAddressSchema = z.object({
  miasto: z.string(),
  kod: z.string().regex(/^\d{2}-\d{3}$/),
  ulica: z.string().optional(),
  budynek: z.string().optional(),
  lokal: z.string().optional(),
  gmina: z.string().optional(),
  powiat: z.string().optional(),
  wojewodztwo: z.string().optional(),
  kraj: z.string().optional(),
  terc: z.string().optional(),
  simc: z.string().optional(),
  ulic: z.string().optional(),
});

// Owner/entrepreneur schema
export const CeidgOwnerSchema = z.object({
  imie: z.string().optional(),
  nazwisko: z.string().optional(),
  nip: z.string().regex(/^\d{10}$/),
  regon: z.string().optional(),
});

// Company schema
export const CeidgCompanySchema = z.object({
  id: z.string().uuid(),
  nazwa: z.string(),
  wlasciciel: CeidgOwnerSchema,
  status: z.enum([
    'AKTYWNY',
    'WYKRESLONY',
    'ZAWIESZONY',
    'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI',
    'WYLACZNIE_W_FORMIE_SPOLKI',
  ]),
  dataRozpoczecia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
    .refine(
      (val) => !isNaN(Date.parse(val)),
      { message: 'Must be a valid date (e.g., 2023-02-30 is invalid)' }
    )
    .describe('Company start date in YYYY-MM-DD format'),
  dataZakonczenia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
    .refine(
      (val) => !isNaN(Date.parse(val)),
      { message: 'Must be a valid date (e.g., 2023-02-30 is invalid)' }
    )
    .optional()
    .describe('Company end date in YYYY-MM-DD format (if deregistered)'),
  adresDzialalnosci: CeidgAddressSchema,
  adresKorespondencyjny: CeidgAddressSchema.optional(),
  link: z.string().url().optional(),
});

// Links schema (pagination links)
export const CeidgLinksSchema = z.object({
  first: z.string().optional(),
  last: z.string().optional(),
  prev: z.string().optional(),
  next: z.string().optional(),
  self: z.string().optional(),
});

// Properties schema (metadata)
export const CeidgPropertiesSchema = z
  .object({
    'dc:title': z.string().optional(),
    'dc:description': z.string().optional(),
    'dc:language': z.string().optional(),
    'schema:provider': z.string().optional(),
    'schema:datePublished': z.string().optional(),
  })
  .passthrough();

// Complete CEIDG response schema
export const CeidgResponseSchema = z.object({
  firmy: z.array(CeidgCompanySchema),
  count: z.number(),
  links: CeidgLinksSchema,
  properties: CeidgPropertiesSchema.optional(),
});

// Exported types inferred from schemas
export type CeidgResponse = z.infer<typeof CeidgResponseSchema>;
export type CeidgCompany = z.infer<typeof CeidgCompanySchema>;
export type CeidgAddress = z.infer<typeof CeidgAddressSchema>;
