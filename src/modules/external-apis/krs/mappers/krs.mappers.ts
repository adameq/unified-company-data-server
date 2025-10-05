import type { KrsResponse } from '../schemas/krs-response.schema';

/**
 * KRS Data Mappers
 *
 * Single Responsibility: Transform KRS API responses to application-specific formats
 *
 * This file contains:
 * - Data transformation utilities for KRS responses
 * - Extraction of specific fields from KRS data structures
 * - No API logic, validation, or business rules
 *
 * Pattern: Follows GUS module structure for separation of concerns
 */

/**
 * Utility functions for data mapping
 */
export const KrsMappers = {
  /**
   * Extract basic company information from KRS response
   *
   * @param krsResponse - Validated KRS API response
   * @returns Basic company information object
   */
  extractBasicInfo: (krsResponse: KrsResponse) => {
    const entity = krsResponse.odpis.dane.dzial1.danePodmiotu;
    const address = krsResponse.odpis.dane.dzial1.siedzibaIAdres?.adres;

    return {
      nazwa: entity.nazwa,
      nip: entity.identyfikatory.nip || undefined,
      regon: entity.identyfikatory.regon,
      krs: krsResponse.odpis.naglowekA.numerKRS,
      adres: address
        ? {
            miejscowosc: address.miejscowosc,
            kodPocztowy: address.kodPocztowy,
            ulica: address.ulica,
            numerBudynku: address.nrDomu,
            numerLokalu: address.nrLokalu,
          }
        : undefined,
      dataStanu: krsResponse.odpis.naglowekA.stanZDnia,
    };
  },

  /**
   * Extract partners/shareholders from KRS data
   *
   * @param krsResponse - Validated KRS API response
   * @returns Array of partners/shareholders
   */
  extractPartners: (krsResponse: KrsResponse) => {
    return krsResponse.odpis.dane.dzial2?.wspolnicy || [];
  },
};
