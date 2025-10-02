/**
 * Correlation ID Utilities - Single Source of Truth
 *
 * Centralized utilities for correlationId generation and extraction.
 * Used across Middleware, Interceptors, Guards, and Filters.
 *
 * Format: req-{timestamp}-{random}
 * Example: req-ljh9k3d-8x7v2w9pq
 *
 * Supports both:
 * - Distributed tracing (accepts ID from upstream via headers)
 * - Standalone operation (generates new ID if none provided)
 */

import { Request } from 'express';

/**
 * Generate a new correlationId with consistent format
 *
 * Format: req-{timestamp}-{random}
 * - timestamp: base36-encoded current timestamp (compact representation)
 * - random: 9-character random string from base36 encoding
 *
 * @returns Generated correlationId string
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `req-${timestamp}-${random}`;
}

/**
 * Extract correlationId from request headers
 *
 * Checks standard headers in order:
 * 1. correlation-id
 * 2. x-correlation-id
 * 3. x-request-id
 *
 * Security: Maximum 128 characters to prevent header injection
 *
 * @param request - Express Request object or object with headers property
 * @returns Extracted correlationId or null if not found/invalid
 */
export function extractFromHeaders(
  request: Request | { headers?: Record<string, string | string[] | undefined> },
): string | null {
  const headers = request.headers || {};
  const id =
    headers['correlation-id'] ||
    headers['x-correlation-id'] ||
    headers['x-request-id'];

  if (typeof id === 'string' && id.trim().length > 0) {
    const trimmed = id.trim();
    // Security: Limit to 128 characters to prevent header injection
    return trimmed.length <= 128 ? trimmed : null;
  }

  return null;
}

/**
 * Extract correlationId from request object
 *
 * Used by Guards, Interceptors, and Filters to read the ID
 * that was set by Middleware on the request object.
 *
 * Type-safe: Uses Express.Request extension from src/types/express.d.ts
 *
 * @param request - Express Request object with correlationId property
 * @returns Extracted correlationId or null if not found
 */
export function extractFromRequest(request: Request): string | null {
  return request?.correlationId || null;
}
