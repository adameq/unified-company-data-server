import { extractSoapResult } from '../../../src/modules/external-apis/gus/gus-soap.helpers';

/**
 * Unit tests for gus-soap.helpers
 *
 * Tests the extractSoapResult helper function which handles
 * strong-soap's inconsistent XML parsing behavior.
 */

describe('extractSoapResult', () => {
  describe('Case Sensitivity Handling', () => {
    test('should extract with exact PascalCase match', () => {
      const result = { DaneSzukajPodmiotyResult: '<xml>data</xml>' };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe('<xml>data</xml>');
    });

    test('should extract with all lowercase match', () => {
      const result = { daneszukajpodmiotyresult: '<xml>data</xml>' };
      // This is the correct lowercase transformation: DaneSzukajPodmiotyResult -> daneszukajpodmiotyresult
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe('<xml>data</xml>');
    });

    test('should extract with mixed case match', () => {
      const result = { DANESzukajPodmiotyRESULT: '<xml>data</xml>' };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe('<xml>data</xml>');
    });

    test('should extract with camelCase match', () => {
      const result = { daneSzukajPodmiotyResult: '<xml>data</xml>' };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe('<xml>data</xml>');
    });

    test('should prefer exact match when multiple case variants exist', () => {
      const result = {
        daneszszukajpodmiotyresult: '<xml>lowercase</xml>',
        DaneSzukajPodmiotyResult: '<xml>pascalcase</xml>',
      };
      // Exact match should be returned first
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe('<xml>pascalcase</xml>');
    });
  });

  describe('Edge Cases', () => {
    test('should return null for null result', () => {
      expect(extractSoapResult(null, 'DaneSzukajPodmioty')).toBeNull();
    });

    test('should return null for undefined result', () => {
      expect(extractSoapResult(undefined, 'DaneSzukajPodmioty')).toBeNull();
    });

    test('should return null for non-object result (string)', () => {
      expect(extractSoapResult('string', 'DaneSzukajPodmioty')).toBeNull();
    });

    test('should return null for non-object result (number)', () => {
      expect(extractSoapResult(123, 'DaneSzukajPodmioty')).toBeNull();
    });

    test('should return null for non-object result (boolean)', () => {
      expect(extractSoapResult(true, 'DaneSzukajPodmioty')).toBeNull();
    });

    test('should return null if key not found', () => {
      const result = { SomeOtherKey: 'value' };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBeNull();
    });

    test('should return null for empty object', () => {
      const result = {};
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBeNull();
    });
  });

  describe('Multiple SOAP Operations', () => {
    test('should work with DanePobierzPelnyRaport operation', () => {
      const result = { DanePobierzPelnyRaportResult: '<xml>report</xml>' };
      expect(extractSoapResult(result, 'DanePobierzPelnyRaport')).toBe('<xml>report</xml>');
    });

    test('should work with DanePobierzPelnyRaport in lowercase', () => {
      const result = { danepobierzpelnyraportresult: '<xml>report</xml>' };
      expect(extractSoapResult(result, 'DanePobierzPelnyRaport')).toBe('<xml>report</xml>');
    });

    test('should work with Zaloguj operation', () => {
      const result = { ZalogujResult: 'session-id-123' };
      expect(extractSoapResult(result, 'Zaloguj')).toBe('session-id-123');
    });

    test('should work with Wyloguj operation', () => {
      const result = { WylogujResult: 'true' };
      expect(extractSoapResult(result, 'Wyloguj')).toBe('true');
    });
  });

  describe('Real-world GUS SOAP Response Scenarios', () => {
    test('should handle GUS classification response (PascalCase)', () => {
      const result = {
        DaneSzukajPodmiotyResult: '<root><dane><Regon>123456789</Regon></dane></root>',
      };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe(
        '<root><dane><Regon>123456789</Regon></dane></root>',
      );
    });

    test('should handle GUS detailed report response (PascalCase)', () => {
      const result = {
        DanePobierzPelnyRaportResult:
          '<root><dane><praw_nazwa>Orange Polska</praw_nazwa></dane></root>',
      };
      expect(extractSoapResult(result, 'DanePobierzPelnyRaport')).toBe(
        '<root><dane><praw_nazwa>Orange Polska</praw_nazwa></dane></root>',
      );
    });

    test('should handle empty GUS response', () => {
      const result = { DaneSzukajPodmiotyResult: '<root></root>' };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe('<root></root>');
    });
  });

  describe('Type Safety', () => {
    test('should handle result with numeric values', () => {
      const result = { DaneSzukajPodmiotyResult: 12345 };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe(12345);
    });

    test('should handle result with boolean values', () => {
      const result = { DaneSzukajPodmiotyResult: true };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toBe(true);
    });

    test('should handle result with object values', () => {
      const result = { DaneSzukajPodmiotyResult: { nested: 'object' } };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toEqual({ nested: 'object' });
    });

    test('should handle result with array values', () => {
      const result = { DaneSzukajPodmiotyResult: ['item1', 'item2'] };
      expect(extractSoapResult(result, 'DaneSzukajPodmioty')).toEqual(['item1', 'item2']);
    });
  });
});
