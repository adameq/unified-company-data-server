import { Request } from 'express';

/**
 * Authentication Utilities
 *
 * Shared utilities for API key extraction and validation.
 * Standardizes authentication across guards and middleware.
 */

/**
 * Extract Bearer token from Authorization header
 *
 * @param request - Express request object
 * @returns API key string if found, null otherwise
 *
 * @example
 * // Authorization: Bearer abc123def456
 * extractBearerToken(request) // returns 'abc123def456'
 *
 * @example
 * // No Authorization header
 * extractBearerToken(request) // returns null
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers?.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();

  return token.length > 0 ? token : null;
}

/**
 * Mask API key for logging (no metadata revealed)
 *
 * Security best practice: Never log any part of secrets, including metadata like length.
 * Returns a constant placeholder that reveals no information about the actual key.
 *
 * Why constant value?
 * - Key length can help attackers optimize brute-force attacks
 * - Different lengths may reveal key format/type (UUID, hex, custom)
 * - Revealing length violates OWASP Logging Cheat Sheet recommendations
 * - Constant value provides zero information leakage
 *
 * @param apiKey - Full API key (or empty string)
 * @returns Constant masked representation for safe logging
 *
 * @example
 * maskApiKey('abc123def456ghi789jkl012') // returns '<redacted>'
 * maskApiKey('short') // returns '<redacted>'
 * maskApiKey('') // returns '<missing>'
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '<missing>';
  }

  return '<redacted>';
}
