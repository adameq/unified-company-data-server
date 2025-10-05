import type { CeidgCompany, CeidgResponse } from '../schemas/ceidg-response.schema';

/**
 * CEIDG Data Mappers
 *
 * Single Responsibility: Transform CEIDG API responses to application-specific formats
 *
 * This file contains:
 * - Data transformation utilities for CEIDG responses
 * - Extraction of specific fields from CEIDG data structures
 * - No API logic, validation, or business rules
 *
 * Pattern: Follows GUS/KRS module structure for separation of concerns
 *
 * Note: Currently a placeholder for future mapper functions.
 * CEIDG service doesn't have complex transformations yet, but this structure
 * maintains consistency with KRS and GUS modules.
 */

/**
 * Utility functions for data mapping
 */
export const CeidgMappers = {
  /**
   * Extract basic company information from CEIDG response
   *
   * @param ceidgCompany - Validated CEIDG company data
   * @returns Basic company information object
   *
   * Note: Currently a simple pass-through, but can be extended
   * for custom transformations as needed.
   */
  extractBasicInfo: (ceidgCompany: CeidgCompany) => {
    return {
      nazwa: ceidgCompany.nazwa,
      nip: ceidgCompany.wlasciciel.nip,
      regon: ceidgCompany.wlasciciel.regon,
      status: ceidgCompany.status,
      dataRozpoczecia: ceidgCompany.dataRozpoczecia,
      dataZakonczenia: ceidgCompany.dataZakonczenia,
      adres: {
        miejscowosc: ceidgCompany.adresDzialalnosci.miasto,
        kodPocztowy: ceidgCompany.adresDzialalnosci.kod,
        ulica: ceidgCompany.adresDzialalnosci.ulica,
        numerBudynku: ceidgCompany.adresDzialalnosci.budynek,
        numerLokalu: ceidgCompany.adresDzialalnosci.lokal,
        wojewodztwo: ceidgCompany.adresDzialalnosci.wojewodztwo,
        powiat: ceidgCompany.adresDzialalnosci.powiat,
        gmina: ceidgCompany.adresDzialalnosci.gmina,
      },
    };
  },

  // Future mapper functions can be added here as needed
  // Example: extractOwnerInfo, extractAddressInfo, etc.
};
