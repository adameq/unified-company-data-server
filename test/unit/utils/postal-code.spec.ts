/**
 * Unit tests for postal code utility functions
 * Tests the utility functions that format Polish postal codes
 */

import { formatPolishPostalCode } from '../../../src/modules/external-apis/gus/gus.service';

describe('formatPolishPostalCode', () => {
  describe('Valid formatting', () => {
    test('should add dash to 5-digit postal code without dash', () => {
      expect(formatPolishPostalCode('00001')).toBe('00-001');
      expect(formatPolishPostalCode('12345')).toBe('12-345');
      expect(formatPolishPostalCode('99999')).toBe('99-999');
    });

    test('should preserve already formatted postal codes', () => {
      expect(formatPolishPostalCode('00-001')).toBe('00-001');
      expect(formatPolishPostalCode('12-345')).toBe('12-345');
      expect(formatPolishPostalCode('99-999')).toBe('99-999');
    });

    test('should handle postal codes with leading zeros', () => {
      expect(formatPolishPostalCode('00123')).toBe('00-123');
      expect(formatPolishPostalCode('01000')).toBe('01-000');
      expect(formatPolishPostalCode('00000')).toBe('00-000');
    });
  });

  describe('Edge cases', () => {
    test('should preserve invalid length postal codes unchanged', () => {
      expect(formatPolishPostalCode('123')).toBe('123');
      expect(formatPolishPostalCode('1234')).toBe('1234');
      expect(formatPolishPostalCode('123456')).toBe('123456');
      expect(formatPolishPostalCode('1234567')).toBe('1234567');
    });

    test('should preserve empty string', () => {
      expect(formatPolishPostalCode('')).toBe('');
    });

    test('should preserve postal codes with multiple dashes', () => {
      expect(formatPolishPostalCode('12-34-5')).toBe('12-34-5');
      expect(formatPolishPostalCode('1-2-3-4-5')).toBe('1-2-3-4-5');
    });

    test('should preserve postal codes with other separators', () => {
      expect(formatPolishPostalCode('12 345')).toBe('12 345');
      expect(formatPolishPostalCode('12.345')).toBe('12.345');
      expect(formatPolishPostalCode('12/345')).toBe('12/345');
    });

    test('should preserve non-numeric 5-character strings unchanged', () => {
      expect(formatPolishPostalCode('abcde')).toBe('abcde');
      expect(formatPolishPostalCode('1a2b3')).toBe('1a2b3');
      expect(formatPolishPostalCode('ABC12')).toBe('ABC12');
    });
  });

  describe('Real-world examples', () => {
    test('should format common Polish postal codes', () => {
      // Warsaw
      expect(formatPolishPostalCode('00001')).toBe('00-001');
      expect(formatPolishPostalCode('02797')).toBe('02-797');

      // Kraków
      expect(formatPolishPostalCode('30001')).toBe('30-001');
      expect(formatPolishPostalCode('31546')).toBe('31-546');

      // Gdańsk
      expect(formatPolishPostalCode('80001')).toBe('80-001');
      expect(formatPolishPostalCode('80952')).toBe('80-952');

      // Poznań
      expect(formatPolishPostalCode('60001')).toBe('60-001');
      expect(formatPolishPostalCode('61896')).toBe('61-896');
    });

    test('should preserve properly formatted Polish postal codes', () => {
      expect(formatPolishPostalCode('00-001')).toBe('00-001');
      expect(formatPolishPostalCode('30-001')).toBe('30-001');
      expect(formatPolishPostalCode('80-001')).toBe('80-001');
      expect(formatPolishPostalCode('61-896')).toBe('61-896');
    });
  });

  describe('Performance', () => {
    test('should format large number of postal codes quickly', () => {
      const start = Date.now();
      const testCodes = Array(1000).fill('12345');

      testCodes.forEach(code => formatPolishPostalCode(code));

      const end = Date.now();
      expect(end - start).toBeLessThan(50); // Should complete in under 50ms
    });
  });

  describe('Data type validation', () => {
    test('should always return string', () => {
      expect(typeof formatPolishPostalCode('12345')).toBe('string');
      expect(typeof formatPolishPostalCode('12-345')).toBe('string');
      expect(typeof formatPolishPostalCode('')).toBe('string');
      expect(typeof formatPolishPostalCode('invalid')).toBe('string');
    });

    test('should never return null or undefined', () => {
      expect(formatPolishPostalCode('12345')).not.toBeNull();
      expect(formatPolishPostalCode('12345')).not.toBeUndefined();
      expect(formatPolishPostalCode('')).not.toBeNull();
      expect(formatPolishPostalCode('')).not.toBeUndefined();
    });
  });

  describe('Algorithm correctness', () => {
    test('should split exactly at position 2', () => {
      const result = formatPolishPostalCode('12345');
      const parts = result.split('-');

      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe('12');
      expect(parts[1]).toBe('345');
    });

    test('should not modify input with existing dash', () => {
      const input = '12-345';
      const result = formatPolishPostalCode(input);

      expect(result).toBe(input);
      expect(result.indexOf('-')).toBe(2);
    });
  });
});