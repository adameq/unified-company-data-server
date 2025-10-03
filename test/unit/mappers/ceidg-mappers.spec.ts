/**
 * Unit tests for CEIDG data mappers
 * Tests the utility functions that map CEIDG API responses to standardized formats
 */

import { CeidgMappers, type CeidgCompany } from '../../../src/modules/external-apis/ceidg/ceidg-v3.service';

describe('CEIDG Mappers', () => {
  // Mock CEIDG response data for testing (NEW API v3 format)
  const mockCeidgCompany: CeidgCompany = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    nazwa: 'Przykładowa Działalność',
    wlasciciel: {
      imie: 'Jan',
      nazwisko: 'Kowalski',
      nip: '1234567890',
      regon: '123456789',
    },
    status: 'AKTYWNY',
    dataRozpoczecia: '2020-01-15',
    dataZakonczenia: undefined,
    adresDzialalnosci: {
      miasto: 'Warszawa',
      kod: '00-001',
      ulica: 'ul. Testowa',
      budynek: '123',
      lokal: '45',
      gmina: 'Warszawa',
      powiat: 'warszawski',
      wojewodztwo: 'mazowieckie',
    },
    adresKorespondencyjny: {
      miasto: 'Kraków',
      kod: '30-001',
      ulica: 'ul. Korespondencyjna',
      budynek: '456',
      lokal: '78',
      gmina: 'Kraków',
      powiat: 'krakowski',
      wojewodztwo: 'małopolskie',
    },
    link: 'https://dane.biznes.gov.pl/api/ceidg/v3/przedsiebiorcy/550e8400-e29b-41d4-a716-446655440000',
  };

  const mockCeidgCompanyWithoutNames: CeidgCompany = {
    id: '660e8400-e29b-41d4-a716-446655440001',
    nazwa: 'Firma Bez Imion',
    wlasciciel: {
      imie: undefined,
      nazwisko: undefined,
      nip: '9876543210',
      regon: '987654321',
    },
    status: 'AKTYWNY',
    dataRozpoczecia: '2019-05-20',
    dataZakonczenia: undefined,
    adresDzialalnosci: {
      miasto: 'Gdańsk',
      kod: '80-001',
      ulica: 'ul. Morska',
      budynek: '789',
    },
  };

  const mockCeidgCompanyDeregistered: CeidgCompany = {
    id: '770e8400-e29b-41d4-a716-446655440002',
    nazwa: 'Wykreślona Firma',
    wlasciciel: {
      nip: '5555555555',
    },
    status: 'WYKRESLONY',
    dataRozpoczecia: '2018-03-10',
    dataZakonczenia: '2023-12-31',
    adresDzialalnosci: {
      miasto: 'Poznań',
      kod: '60-001',
    },
  };

  const mockCeidgCompanySuspended: CeidgCompany = {
    id: '880e8400-e29b-41d4-a716-446655440003',
    nazwa: 'Zawieszona Działalność',
    wlasciciel: {
      nip: '7777777777',
    },
    status: 'ZAWIESZONY',
    dataRozpoczecia: '2021-06-15',
    adresDzialalnosci: {
      miasto: 'Wrocław',
      kod: '50-001',
    },
  };

  describe('mapToUnifiedData', () => {
    test('should map complete CEIDG company with first name and last name', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompany);

      expect(result).toEqual({
        nazwa: 'Jan Kowalski',
        nip: '1234567890',
        regon: '123456789',
        adres: {
          miejscowosc: 'Warszawa',
          kodPocztowy: '00-001',
          ulica: 'ul. Testowa',
          numerBudynku: '123',
          numerLokalu: '45',
          wojewodztwo: 'mazowieckie',
          powiat: 'warszawski',
          gmina: 'Warszawa',
        },
        status: 'AKTYWNY',
        isActive: true, // NEW: status AKTYWNY and no dataZakonczenia
        dataRozpoczeciaDzialalnosci: '2020-01-15',
        dataZakonczeniaDzialalnosci: undefined,
        typPodmiotu: 'FIZYCZNA',
        formaPrawna: 'DZIAŁALNOŚĆ GOSPODARCZA',
        zrodloDanych: 'CEIDG',
      });
    });

    test('should use company name when first name and last name are missing', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompanyWithoutNames);

      expect(result.nazwa).toBe('Firma Bez Imion');
      expect(result.nip).toBe('9876543210');
      expect(result.regon).toBe('987654321');
      expect(result.typPodmiotu).toBe('FIZYCZNA');
      expect(result.formaPrawna).toBe('DZIAŁALNOŚĆ GOSPODARCZA');
      expect(result.zrodloDanych).toBe('CEIDG');
    });

    test('should handle partial address information', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompanyWithoutNames);

      expect(result.adres).toEqual({
        miejscowosc: 'Gdańsk',
        kodPocztowy: '80-001',
        ulica: 'ul. Morska',
        numerBudynku: '789',
        numerLokalu: undefined,
        wojewodztwo: undefined,
        powiat: undefined,
        gmina: undefined,
      });
    });

    test('should map deregistered company correctly', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompanyDeregistered);

      expect(result.status).toBe('WYKRESLONY');
      expect(result.isActive).toBe(false);
      expect(result.dataZakonczeniaDzialalnosci).toBe('2023-12-31');
      expect(result.typPodmiotu).toBe('FIZYCZNA');
    });

    test('should map suspended company correctly', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompanySuspended);

      expect(result.status).toBe('ZAWIESZONY');
      expect(result.isActive).toBe(false);
      expect(result.dataZakonczeniaDzialalnosci).toBeUndefined();
    });

    test('should handle minimal address data', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompanyDeregistered);

      expect(result.adres).toEqual({
        miejscowosc: 'Poznań',
        kodPocztowy: '60-001',
        ulica: undefined,
        numerBudynku: undefined,
        numerLokalu: undefined,
        wojewodztwo: undefined,
        powiat: undefined,
        gmina: undefined,
      });
    });
  });

  describe('isDeregistered', () => {
    test('should return true for deregistered company', () => {
      const result = CeidgMappers.isDeregistered(mockCeidgCompanyDeregistered);
      expect(result).toBe(true);
    });

    test('should return false for active company', () => {
      const result = CeidgMappers.isDeregistered(mockCeidgCompany);
      expect(result).toBe(false);
    });

    test('should return false for suspended company', () => {
      const result = CeidgMappers.isDeregistered(mockCeidgCompanySuspended);
      expect(result).toBe(false);
    });

    test('should handle different statuses correctly', () => {
      const testCases = [
        { status: 'AKTYWNY', expected: false },
        { status: 'WYKRESLONY', expected: true },
        { status: 'ZAWIESZONY', expected: false },
        { status: 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI', expected: false },
        { status: 'WYLACZNIE_W_FORMIE_SPOLKI', expected: false },
      ] as const;

      testCases.forEach(({ status, expected }) => {
        const testCompany: CeidgCompany = {
          ...mockCeidgCompany,
          status,
        };
        const result = CeidgMappers.isDeregistered(testCompany);
        expect(result).toBe(expected);
      });
    });
  });

  describe('isSuspended', () => {
    test('should return true for suspended company', () => {
      const result = CeidgMappers.isSuspended(mockCeidgCompanySuspended);
      expect(result).toBe(true);
    });

    test('should return false for active company', () => {
      const result = CeidgMappers.isSuspended(mockCeidgCompany);
      expect(result).toBe(false);
    });

    test('should return false for deregistered company', () => {
      const result = CeidgMappers.isSuspended(mockCeidgCompanyDeregistered);
      expect(result).toBe(false);
    });

    test('should handle different statuses correctly', () => {
      const testCases = [
        { status: 'AKTYWNY', expected: false },
        { status: 'WYKRESLONY', expected: false },
        { status: 'ZAWIESZONY', expected: true },
        { status: 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI', expected: false },
        { status: 'WYLACZNIE_W_FORMIE_SPOLKI', expected: false },
      ] as const;

      testCases.forEach(({ status, expected }) => {
        const testCompany: CeidgCompany = {
          ...mockCeidgCompany,
          status,
        };
        const result = CeidgMappers.isSuspended(testCompany);
        expect(result).toBe(expected);
      });
    });
  });

  describe('getMailingAddress', () => {
    test('should return correspondence address when available', () => {
      const result = CeidgMappers.getMailingAddress(mockCeidgCompany);

      expect(result).toEqual({
        miasto: 'Kraków',
        kod: '30-001',
        ulica: 'ul. Korespondencyjna',
        budynek: '456',
        lokal: '78',
        gmina: 'Kraków',
        powiat: 'krakowski',
        wojewodztwo: 'małopolskie',
      });
    });

    test('should fallback to business address when correspondence address is not available', () => {
      const result = CeidgMappers.getMailingAddress(mockCeidgCompanyWithoutNames);

      expect(result).toEqual({
        miasto: 'Gdańsk',
        kod: '80-001',
        ulica: 'ul. Morska',
        budynek: '789',
      });
    });

    test('should handle company without correspondence address', () => {
      const companyWithoutCorrespondence: CeidgCompany = {
        ...mockCeidgCompany,
        adresKorespondencyjny: undefined,
      };

      const result = CeidgMappers.getMailingAddress(companyWithoutCorrespondence);

      expect(result).toEqual(mockCeidgCompany.adresDzialalnosci);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle company with empty optional fields', () => {
      const companyWithMinimalData: CeidgCompany = {
        id: '990e8400-e29b-41d4-a716-446655440005',
        nazwa: 'Minimalna Firma',
        wlasciciel: {
          nip: '1111111111',
        },
        status: 'AKTYWNY',
        dataRozpoczecia: '2022-01-01',
        adresDzialalnosci: {
          miasto: 'Testowo',
          kod: '12-345',
        },
      };

      const result = CeidgMappers.mapToUnifiedData(companyWithMinimalData);

      expect(result.nazwa).toBe('Minimalna Firma');
      expect(result.regon).toBeUndefined();
      expect(result.adres.ulica).toBeUndefined();
      expect(result.dataZakonczeniaDzialalnosci).toBeUndefined();
    });

    test('should prioritize first name and last name over company name', () => {
      const companyWithBothNameTypes: CeidgCompany = {
        ...mockCeidgCompany,
        nazwa: 'Nazwa Firmy XYZ',
        wlasciciel: {
          ...mockCeidgCompany.wlasciciel,
          imie: 'Anna',
          nazwisko: 'Nowak',
        },
      };

      const result = CeidgMappers.mapToUnifiedData(companyWithBothNameTypes);
      expect(result.nazwa).toBe('Anna Nowak');
    });

    test('should handle partial name information correctly', () => {
      const testCases = [
        {
          imie: 'Jan',
          nazwisko: undefined,
          nazwa: 'Firma Test',
          expected: 'Firma Test',
        },
        {
          imie: undefined,
          nazwisko: 'Kowalski',
          nazwa: 'Firma Test',
          expected: 'Firma Test',
        },
        {
          imie: '',
          nazwisko: 'Kowalski',
          nazwa: 'Firma Test',
          expected: 'Firma Test',
        },
        {
          imie: 'Jan',
          nazwisko: '',
          nazwa: 'Firma Test',
          expected: 'Firma Test',
        },
      ];

      testCases.forEach(({ imie, nazwisko, nazwa, expected }) => {
        const company: CeidgCompany = {
          ...mockCeidgCompany,
          wlasciciel: {
            ...mockCeidgCompany.wlasciciel,
            imie,
            nazwisko,
          },
          nazwa,
        };

        const result = CeidgMappers.mapToUnifiedData(company);
        expect(result.nazwa).toBe(expected);
      });
    });
  });

  describe('Data Type Validation', () => {
    test('mapped data should have correct types', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompany);

      expect(typeof result.nazwa).toBe('string');
      expect(typeof result.nip).toBe('string');
      expect(typeof result.status).toBe('string');
      expect(typeof result.isActive).toBe('boolean');
      expect(typeof result.dataRozpoczeciaDzialalnosci).toBe('string');
      expect(typeof result.typPodmiotu).toBe('string');
      expect(typeof result.formaPrawna).toBe('string');
      expect(typeof result.zrodloDanych).toBe('string');
      expect(typeof result.adres).toBe('object');

      if (result.adres) {
        expect(typeof result.adres.miejscowosc).toBe('string');
        expect(typeof result.adres.kodPocztowy).toBe('string');
      }
    });

    test('status check functions should return boolean', () => {
      expect(typeof CeidgMappers.isDeregistered(mockCeidgCompany)).toBe('boolean');
      expect(typeof CeidgMappers.isSuspended(mockCeidgCompany)).toBe('boolean');
    });

    test('getMailingAddress should return address object', () => {
      const result = CeidgMappers.getMailingAddress(mockCeidgCompany);
      expect(typeof result).toBe('object');
      expect(typeof result.miasto).toBe('string');
      expect(typeof result.kod).toBe('string');
    });
  });

  describe('Constant Values', () => {
    test('should always set correct constant values', () => {
      const result = CeidgMappers.mapToUnifiedData(mockCeidgCompany);

      expect(result.typPodmiotu).toBe('FIZYCZNA');
      expect(result.formaPrawna).toBe('DZIAŁALNOŚĆ GOSPODARCZA');
      expect(result.zrodloDanych).toBe('CEIDG');
    });

    test('should set isActive based on status', () => {
      const activeCompany: CeidgCompany = { ...mockCeidgCompany, status: 'AKTYWNY' };
      const inactiveCompany: CeidgCompany = { ...mockCeidgCompany, status: 'WYKRESLONY' };

      expect(CeidgMappers.mapToUnifiedData(activeCompany).isActive).toBe(true);
      expect(CeidgMappers.mapToUnifiedData(inactiveCompany).isActive).toBe(false);
    });
  });
});