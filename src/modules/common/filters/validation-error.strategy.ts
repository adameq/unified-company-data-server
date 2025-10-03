import {
  createErrorResponse,
  type ErrorResponse,
  type ErrorCode,
  ERROR_CODES,
} from '@schemas/error-response.schema';

/**
 * Validation Error Strategy
 *
 * Declarative rules for mapping validation error messages to ErrorCodes
 * and creating user-friendly error messages.
 *
 * Benefits over imperative if/else:
 * - Easy to add new rules
 * - Testable in isolation
 * - Clear separation of concerns
 */

export interface ValidationRule {
  /** Name for debugging/testing */
  name: string;

  /** Check if this rule matches the validation messages */
  matches: (messages: string[]) => boolean;

  /** ErrorCode to use if rule matches */
  errorCode: ErrorCode;

  /** User-friendly message template */
  messageTemplate: string | ((messages: string[]) => string);
}

/**
 * Declarative validation rules
 * Evaluated in order - first match wins
 */
const VALIDATION_RULES: ValidationRule[] = [
  {
    name: 'NIP validation error',
    matches: (messages) =>
      messages.some((msg) => msg.toLowerCase().includes('nip')),
    errorCode: ERROR_CODES.INVALID_NIP_FORMAT,
    messageTemplate: 'Invalid NIP format. Expected exactly 10 digits.',
  },
  {
    name: 'Missing required fields',
    matches: (messages) =>
      messages.some((msg) => {
        const lowerMsg = msg.toLowerCase();
        return (
          lowerMsg.includes('required') ||
          lowerMsg.includes('should not be empty') ||
          lowerMsg.includes('must be a string') ||
          lowerMsg.includes('must be defined')
        );
      }),
    errorCode: ERROR_CODES.MISSING_REQUIRED_FIELDS,
    messageTemplate: 'Required fields are missing from the request.',
  },
  {
    name: 'Invalid request format (unknown properties)',
    matches: (messages) =>
      messages.some((msg) => msg.toLowerCase().includes('property')),
    errorCode: ERROR_CODES.INVALID_REQUEST_FORMAT,
    messageTemplate: (messages) => {
      // Extract field names from messages like "property fieldName should not exist"
      const fieldMatches = messages
        .map((msg) => {
          const match = msg.match(/property (\w+)/);
          return match ? match[1] : null;
        })
        .filter((field): field is string => field !== null);

      if (fieldMatches.length > 0) {
        const fields = fieldMatches.join(', ');
        return `Invalid request format. Check fields: ${fields}`;
      }

      return 'Invalid request format.';
    },
  },
  {
    name: 'Generic validation error (fallback)',
    matches: () => true, // Always matches (fallback)
    errorCode: ERROR_CODES.INVALID_REQUEST_FORMAT,
    messageTemplate: 'Validation failed.',
  },
];

/**
 * Validation Error Strategy
 *
 * Converts ValidationPipe error messages to ErrorResponse using declarative rules
 */
export class ValidationErrorStrategy {
  /**
   * Find the first rule that matches the validation messages
   */
  static findMatchingRule(messages: string[]): ValidationRule {
    const rule = VALIDATION_RULES.find((r) => r.matches(messages));

    // Fallback to last rule (generic validation error)
    return rule || VALIDATION_RULES[VALIDATION_RULES.length - 1];
  }

  /**
   * Create user-friendly message from rule template
   */
  static createMessage(
    rule: ValidationRule,
    messages: string[],
  ): string {
    if (typeof rule.messageTemplate === 'function') {
      return rule.messageTemplate(messages);
    }

    return rule.messageTemplate;
  }

  /**
   * Convert validation error messages to ErrorResponse
   *
   * Main entry point used by ValidationPipeErrorHandler
   */
  static createErrorResponse(
    validationMessages: string[],
    correlationId: string,
  ): ErrorResponse {
    const rule = this.findMatchingRule(validationMessages);
    const message = this.createMessage(rule, validationMessages);

    return createErrorResponse({
      errorCode: rule.errorCode,
      message,
      correlationId,
      source: 'INTERNAL',
      details: {
        validationErrors: validationMessages,
      },
    });
  }

  /**
   * Get all validation rules (for testing/debugging)
   */
  static getRules(): ValidationRule[] {
    return [...VALIDATION_RULES];
  }
}
