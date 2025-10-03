import { z } from 'zod';
import { validateNIP } from '../../../src/common/validators/nip.validator';

/**
 * Unit tests for NIP validation
 * Tests the NIP validation function from src/common/validators/nip.validator.ts
 *
 * NIP (Tax Identification Number) must:
 * - Be exactly 10 digits
 * - Pass checksum validation
 * - Handle various formats (with/without separators)
 */

describe('NIP Validation', () => {
  describe('Valid NIPs', () => {
    // Using known valid NIPs that pass checksum validation
    const validNips = [
      '5260001246', // Known valid NIP
      '1234567890', // Valid calculated NIP
    ];

    // First let's test one by one to verify which ones actually work
    test('should validate known good NIP: 5260001246', () => {
      expect(validateNIP('5260001246')).toBe(true);
    });

    test('should handle NIP with separators for valid NIP', () => {
      expect(validateNIP('526-000-12-46')).toBe(true);
      expect(validateNIP('526 000 12 46')).toBe(true);
      expect(validateNIP('526.000.12.46')).toBe(true);
    });

    test('should handle NIP with mixed separators for valid NIP', () => {
      expect(validateNIP('526-000 12.46')).toBe(true);
    });
  });

  describe('Invalid NIPs', () => {
    test('should reject empty strings', () => {
      expect(validateNIP('')).toBe(false);
    });

    test('should reject too short NIPs', () => {
      expect(validateNIP('123')).toBe(false);
      expect(validateNIP('123456789')).toBe(false);
    });

    test('should reject too long NIPs', () => {
      expect(validateNIP('12345678901')).toBe(false);
      expect(validateNIP('123456789012')).toBe(false);
    });

    test('should reject non-numeric characters', () => {
      expect(validateNIP('abcdefghij')).toBe(false);
      expect(validateNIP('123abc7890')).toBe(false);
    });

    test('should reject NIP with special characters only', () => {
      expect(validateNIP('!@#$%^&*()')).toBe(false);
    });

    test('should reject null/undefined', () => {
      expect(validateNIP(null as any)).toBe(false);
      expect(validateNIP(undefined as any)).toBe(false);
    });

    test('should reject NIPs with wrong checksum', () => {
      expect(validateNIP('1234567891')).toBe(false); // Last digit wrong
      expect(validateNIP('5260001245')).toBe(false); // Known good NIP with wrong checksum
    });
  });

  describe('Edge Cases', () => {
    test('should handle whitespace padding', () => {
      expect(validateNIP(' 5260001246 ')).toBe(true);
      expect(validateNIP('\t5260001246\n')).toBe(true);
    });

    test('should handle various separators', () => {
      expect(validateNIP('526/000/12/46')).toBe(true);
      expect(validateNIP('526_000_12_46')).toBe(true);
      expect(validateNIP('(526) 000-12-46')).toBe(true);
    });
  });

  describe('Format Flexibility', () => {
    // Use known valid NIP for all format tests
    const goodNip = '5260001246';
    const variations = [
      { input: goodNip, expected: true, desc: 'plain digits' },
      { input: '526-000-12-46', expected: true, desc: 'dashes' },
      { input: '526 000 12 46', expected: true, desc: 'spaces' },
      { input: '526.000.12.46', expected: true, desc: 'dots' },
      { input: '526/000/12/46', expected: true, desc: 'slashes' },
      { input: ` ${goodNip} `, expected: true, desc: 'whitespace padding' },
      { input: '(526) 000-12-46', expected: true, desc: 'parentheses and mixed' },
    ];

    test.each(variations)('should handle $desc format: $input', ({ input, expected }) => {
      expect(validateNIP(input)).toBe(expected);
    });
  });

  describe('Checksum Algorithm', () => {
    test('should verify checksum calculation for known valid NIP', () => {
      // Test with known valid NIP
      expect(validateNIP('5260001246')).toBe(true);
    });

    test('should reject when checksum is wrong', () => {
      // Same digits but wrong last digit
      expect(validateNIP('5260001247')).toBe(false);
      expect(validateNIP('5260001245')).toBe(false);
    });
  });

  describe('Performance', () => {
    test('should validate large number of NIPs quickly', () => {
      const start = Date.now();
      const testNips = Array(1000).fill('5260001246'); // Use valid NIP

      testNips.forEach(nip => validateNIP(nip));

      const end = Date.now();
      expect(end - start).toBeLessThan(100); // Should complete in under 100ms
    });
  });

  describe('Real-world examples', () => {
    test('should validate known valid NIP', () => {
      expect(validateNIP('5260001246')).toBe(true);
    });

    test('should handle different valid formats', () => {
      expect(validateNIP('526-000-12-46')).toBe(true);
      expect(validateNIP('526 000 12 46')).toBe(true);
    });
  });
});

describe('NIP Zod Schema Integration', () => {
  // Test how NIP validation integrates with Zod schemas
  const NipSchema = z.string().refine(validateNIP, {
    message: 'Invalid NIP format or checksum',
  });

  test('should validate valid NIP through Zod schema', () => {
    expect(() => NipSchema.parse('5260001246')).not.toThrow();
  });

  test('should reject invalid NIP through Zod schema', () => {
    expect(() => NipSchema.parse('invalid')).toThrow();
    expect(() => NipSchema.parse('1234567891')).toThrow(); // Wrong checksum
  });

  test('should provide custom error message', () => {
    try {
      NipSchema.parse('invalid');
    } catch (error) {
      expect((error as any).issues[0].message).toBe('Invalid NIP format or checksum');
    }
  });
});