/**
 * Postal Code Utilities
 *
 * Utility functions for formatting and validating postal codes.
 */

/**
 * Format Polish postal code by adding dash separator
 *
 * Formats 5-digit postal codes to the standard Polish format (XX-XXX).
 * Only formats codes that are exactly 5 digits without any separators.
 * Preserves already formatted codes and invalid inputs unchanged.
 *
 * @param code - Postal code to format (may be formatted or unformatted)
 * @returns Formatted postal code in XX-XXX format, or original input if invalid
 *
 * @example
 * formatPolishPostalCode('12345')   // returns '12-345'
 * formatPolishPostalCode('12-345')  // returns '12-345' (already formatted)
 * formatPolishPostalCode('1234')    // returns '1234' (invalid length)
 * formatPolishPostalCode('abcde')   // returns 'abcde' (non-numeric)
 */
export function formatPolishPostalCode(code: string): string {
  // Only format if exactly 5 digits (no dash)
  if (code.length === 5 && !code.includes('-') && /^\d{5}$/.test(code)) {
    return `${code.slice(0, 2)}-${code.slice(2)}`;
  }
  return code;
}
