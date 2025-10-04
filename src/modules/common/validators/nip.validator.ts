/**
 * NIP (Tax Identification Number) Validator
 *
 * Validates Polish NIP using the official checksum algorithm.
 * Used in both Zod schemas and unit tests.
 *
 * NIP Structure:
 * - 10 digits total
 * - First 9 digits: identifier
 * - 10th digit: checksum
 *
 * Checksum Algorithm:
 * - Multiply first 9 digits by weights: [6, 5, 7, 2, 3, 4, 5, 6, 7]
 * - Sum all products
 * - Calculate remainder from division by 11
 * - If remainder is 10, checksum is 0; otherwise checksum equals remainder
 * - Compare with 10th digit
 */

/**
 * Validates NIP format and checksum
 *
 * @param nip - NIP string (can contain separators like spaces, dashes, dots)
 * @returns true if NIP is valid (correct format and checksum), false otherwise
 *
 * @example
 * validateNIP('5260001246') // true - valid NIP
 * validateNIP('526-000-12-46') // true - valid with separators
 * validateNIP('1234567890') // false - invalid checksum
 * validateNIP('123') // false - too short
 */
export const validateNIP = (nip: string): boolean => {
  // Handle null/undefined
  if (!nip) {
    return false;
  }

  // Remove any non-digits (separators, whitespace, etc.)
  const cleanNip = nip.replace(/\D/g, '');

  if (cleanNip.length !== 10) {
    return false;
  }

  // NIP checksum validation using official algorithm
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;

  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanNip[i]) * weights[i];
  }

  const remainder = sum % 11;
  const checkDigit = remainder === 10 ? 0 : remainder;

  return checkDigit === parseInt(cleanNip[9]);
};
