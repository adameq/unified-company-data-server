/**
 * Unit tests for KRS data mappers
 * Tests the utility functions that map KRS API responses to standardized formats
 */

import { KrsMappers, type KrsResponse } from '../../../src/modules/external-apis/krs/krs.service';

describe('KRS Mappers', () => {
  // Mock KRS response data for testing
  const mockKrsResponse: KrsResponse = {
    odpis: {
      rodzaj: 'pelny',
      naglowekA: {
        rejestr: 'P',
        numerKRS: '0000123456',
        stanZDnia: '2025-09-27',
      },
      dane: {
        dzial1: {
          danePodmiotu: {
            formaPrawna: 'Spółka z ograniczoną odpowiedzialnością',
            identyfikatory: {
              nip: '1234567890',
              regon: '123456789',
            },
            nazwa: 'Przykładowa Spółka z o.o.',
          },
          siedzibaIAdres: {
            siedziba: {
              kraj: 'Polska',
              wojewodztwo: 'mazowieckie',
              powiat: 'warszawa',
              gmina: 'Warszawa',
              miejscowosc: 'Warszawa',
            },
            adres: {
              kodPocztowy: '00-001',
              miejscowosc: 'Warszawa',
              ulica: 'ul. Testowa',
              nrDomu: '123',
              nrLokalu: '45',
            },
          },
        },
        dzial2: {
          wspolnicy: [
            {
              nazwa: 'Jan Kowalski',
              adres: 'ul. Partnerska 1, 00-002 Warszawa',
            },
            {
              nazwa: 'Firma Partner Sp. z o.o.',
              adres: 'ul. Biznesowa 2, 00-003 Warszawa',
            },
          ],
        },
      },
    },
  };

  const mockKrsResponseWithoutAddress: KrsResponse = {
    odpis: {
      rodzaj: 'pelny',
      naglowekA: {
        rejestr: 'P',
        numerKRS: '0000987654',
        stanZDnia: '2025-09-27',
      },
      dane: {
        dzial1: {
          danePodmiotu: {
            formaPrawna: 'Spółka z ograniczoną odpowiedzialnością',
            identyfikatory: {
              nip: '9876543210',
              regon: '987654321',
            },
            nazwa: 'Firma bez adresu',
          },
          // No siedzibaIAdres
        },
      },
    },
  };

  describe('extractBasicInfo', () => {
    test('should extract complete company information', () => {
      const result = KrsMappers.extractBasicInfo(mockKrsResponse);

      expect(result).toEqual({
        nazwa: 'Przykładowa Spółka z o.o.',
        nip: '1234567890',
        regon: '123456789',
        krs: '0000123456',
        adres: {
          miejscowosc: 'Warszawa',
          kodPocztowy: '00-001',
          ulica: 'ul. Testowa',
          numerBudynku: '123',
          numerLokalu: '45',
        },
        dataStanu: '2025-09-27',
      });
    });

    test('should handle missing address information', () => {
      const result = KrsMappers.extractBasicInfo(mockKrsResponseWithoutAddress);

      expect(result).toEqual({
        nazwa: 'Firma bez adresu',
        nip: '9876543210',
        regon: '987654321',
        krs: '0000987654',
        adres: undefined,
        dataStanu: '2025-09-27',
      });
    });

    test('should handle optional fields in address', () => {
      const responseWithPartialAddress: KrsResponse = {
        ...mockKrsResponse,
        odpis: {
          ...mockKrsResponse.odpis,
          dane: {
            ...mockKrsResponse.odpis.dane,
            dzial1: {
              danePodmiotu: {
                formaPrawna: 'Spółka z ograniczoną odpowiedzialnością',
                identyfikatory: {
                  nip: '1234567890',
                  regon: '123456789',
                },
                nazwa: 'Przykładowa Spółka z o.o.',
              },
              siedzibaIAdres: {
                siedziba: {
                  kraj: 'Polska',
                  wojewodztwo: 'małopolskie',
                  powiat: 'kraków',
                  gmina: 'Kraków',
                  miejscowosc: 'Kraków',
                },
                adres: {
                  miejscowosc: 'Kraków',
                  kodPocztowy: '30-001',
                  // Missing ulica, nrDomu, nrLokalu
                },
              },
            },
          },
        },
      };

      const result = KrsMappers.extractBasicInfo(responseWithPartialAddress);

      expect(result.adres).toEqual({
        miejscowosc: 'Kraków',
        kodPocztowy: '30-001',
        ulica: undefined,
        numerBudynku: undefined,
        numerLokalu: undefined,
      });
    });
  });

  describe('extractPartners', () => {
    test('should return partners when dzial2 exists', () => {
      const result = KrsMappers.extractPartners(mockKrsResponse);

      expect(result).toEqual([
        {
          nazwa: 'Jan Kowalski',
          adres: 'ul. Partnerska 1, 00-002 Warszawa',
        },
        {
          nazwa: 'Firma Partner Sp. z o.o.',
          adres: 'ul. Biznesowa 2, 00-003 Warszawa',
        },
      ]);
    });

    test('should return empty array when dzial2 does not exist', () => {
      const result = KrsMappers.extractPartners(mockKrsResponseWithoutAddress);
      expect(result).toEqual([]);
    });

    test('should return empty array when wspolnicy is undefined', () => {
      const responseWithoutPartners: KrsResponse = {
        ...mockKrsResponse,
        odpis: {
          ...mockKrsResponse.odpis,
          dane: {
            ...mockKrsResponse.odpis.dane,
            dzial2: {
              // wspolnicy is undefined
            },
          },
        },
      };

      const result = KrsMappers.extractPartners(responseWithoutPartners);
      expect(result).toEqual([]);
    });

    test('should handle empty partners array', () => {
      const responseWithEmptyPartners: KrsResponse = {
        ...mockKrsResponse,
        odpis: {
          ...mockKrsResponse.odpis,
          dane: {
            ...mockKrsResponse.odpis.dane,
            dzial2: {
              wspolnicy: [],
            },
          },
        },
      };

      const result = KrsMappers.extractPartners(responseWithEmptyPartners);
      expect(result).toEqual([]);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle missing optional NIP in extractBasicInfo', () => {
      const responseWithoutNip: KrsResponse = {
        ...mockKrsResponse,
        odpis: {
          ...mockKrsResponse.odpis,
          dane: {
            ...mockKrsResponse.odpis.dane,
            dzial1: {
              danePodmiotu: {
                formaPrawna: 'Spółka z ograniczoną odpowiedzialnością',
                identyfikatory: {
                  nip: '',
                  regon: '123456789',
                },
                nazwa: 'Firma bez NIP',
              },
              // No siedzibaIAdres
            },
          },
        },
      };

      const result = KrsMappers.extractBasicInfo(responseWithoutNip);
      expect(result.nip).toBeUndefined();
      expect(result.nazwa).toBe('Firma bez NIP');
    });

    test('should handle different date formats in stanZDnia', () => {
      const responseWithDifferentDate: KrsResponse = {
        ...mockKrsResponse,
        odpis: {
          ...mockKrsResponse.odpis,
          naglowekA: {
            rejestr: 'P',
            numerKRS: '0000123456',
            stanZDnia: '2025-12-31',
          },
        },
      };

      const result = KrsMappers.extractBasicInfo(responseWithDifferentDate);
      expect(result.dataStanu).toBe('2025-12-31');
    });
  });

  describe('Data Type Validation', () => {
    test('extracted data should have correct types', () => {
      const result = KrsMappers.extractBasicInfo(mockKrsResponse);

      expect(typeof result.nazwa).toBe('string');
      expect(typeof result.nip).toBe('string');
      expect(typeof result.regon).toBe('string');
      expect(typeof result.krs).toBe('string');
      expect(typeof result.dataStanu).toBe('string');
      expect(typeof result.adres).toBe('object');

      if (result.adres) {
        expect(typeof result.adres.miejscowosc).toBe('string');
        expect(typeof result.adres.kodPocztowy).toBe('string');
      }
    });

    test('extractPartners should return array', () => {
      const result = KrsMappers.extractPartners(mockKrsResponse);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});