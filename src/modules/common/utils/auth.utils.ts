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
 * Mask API key for logging (shows no characters for security)
 *
 * Security best practice: Never log any part of secrets, even masked.
 * This function returns only metadata (length) without revealing actual key content.
 *
 * @param apiKey - Full API key
 * @returns Masked representation for safe logging
 *
 * @example
 * maskApiKey('abc123def456ghi789') // returns '<redacted:18chars>'
 * maskApiKey('') // returns '<missing>'
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '<missing>';
  }

  return `<redacted:${apiKey.length}chars>`;
}
