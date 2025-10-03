import { ValidationError } from 'class-validator';
import {
  ValidationException,
  type ValidationErrorDetail,
} from '../exceptions/validation.exception';
import { type ErrorCode, ERROR_CODES } from '@schemas/error-response.schema';

/**
 * ValidationExceptionFactory
 *
 * Creates structured ValidationException from class-validator errors.
 * Maps validation constraints (not messages) to ErrorCodes.
 *
 * Benefits:
 * - No string parsing (robust against message changes)
 * - Constraint-based mapping (precise and deterministic)
 * - Easy to extend with new constraint mappings
 * - Follows NestJS best practices (custom exceptionFactory)
 *
 * Constraint → ErrorCode Mapping:
 * - matches + nip field → INVALID_NIP_FORMAT
 * - isNotEmpty → MISSING_REQUIRED_FIELDS
 * - isString → MISSING_REQUIRED_FIELDS
 * - isDefined → MISSING_REQUIRED_FIELDS
 * - whitelistValidation → INVALID_REQUEST_FORMAT
 * - other constraints → INVALID_REQUEST_FORMAT
 */
export class ValidationExceptionFactory {
  /**
   * Create ValidationException from class-validator errors
   *
   * Used as exceptionFactory in ValidationPipe:
   * ```typescript
   * new ValidationPipe({
   *   exceptionFactory: ValidationExceptionFactory.create,
   * })
   * ```
   */
  static create(errors: ValidationError[]): ValidationException {
    const validationErrors = this.extractValidationErrors(errors);
    const errorCode = this.determineErrorCode(validationErrors);
    const message = this.createMessage(errorCode, validationErrors);

    return new ValidationException(errorCode, message, validationErrors);
  }

  /**
   * Extract structured validation error details from class-validator errors
   */
  private static extractValidationErrors(
    errors: ValidationError[],
  ): ValidationErrorDetail[] {
    const details: ValidationErrorDetail[] = [];

    for (const error of errors) {
      if (error.constraints) {
        // Extract constraint type and message for each validation rule
        for (const [constraint, message] of Object.entries(error.constraints)) {
          details.push({
            property: error.property,
            value: error.value,
            constraint,
            message,
          });
        }
      }

      // Handle nested validation errors recursively
      if (error.children && error.children.length > 0) {
        const nestedErrors = this.extractValidationErrors(error.children);
        details.push(...nestedErrors);
      }
    }

    return details;
  }

  /**
   * Determine ErrorCode based on validation constraint types
   *
   * Priority order (first match wins):
   * 1. NIP-specific validation (any constraint on nip field)
   * 2. Whitelist validation (extra fields)
   * 3. Missing required fields (isNotEmpty, isString, isDefined)
   * 4. Generic validation error (fallback)
   */
  private static determineErrorCode(
    errors: ValidationErrorDetail[],
  ): ErrorCode {
    // Check for NIP validation errors (highest priority)
    // ANY validation error on 'nip' field should be INVALID_NIP_FORMAT
    const nipError = errors.find((err) => err.property === 'nip');

    if (nipError) {
      return ERROR_CODES.INVALID_NIP_FORMAT;
    }

    // Check for whitelist validation (extra unexpected fields)
    const whitelistError = errors.find((err) =>
      err.constraint.toLowerCase().includes('whitelist'),
    );

    if (whitelistError) {
      return ERROR_CODES.INVALID_REQUEST_FORMAT;
    }

    // Check for missing required fields
    const missingFieldError = errors.find((err) =>
      this.isMissingFieldConstraint(err.constraint),
    );

    if (missingFieldError) {
      return ERROR_CODES.MISSING_REQUIRED_FIELDS;
    }

    // Fallback to generic validation error
    return ERROR_CODES.INVALID_REQUEST_FORMAT;
  }

  /**
   * Check if constraint indicates missing/empty required field
   */
  private static isMissingFieldConstraint(constraint: string): boolean {
    const missingFieldConstraints = [
      'isNotEmpty',
      'isString',
      'isDefined',
      'isNumber',
      'isBoolean',
      'isDate',
      'isArray',
      'isObject',
    ];

    return missingFieldConstraints.includes(constraint);
  }

  /**
   * Create user-friendly error message based on ErrorCode
   */
  private static createMessage(
    errorCode: ErrorCode,
    errors: ValidationErrorDetail[],
  ): string {
    switch (errorCode) {
      case ERROR_CODES.INVALID_NIP_FORMAT:
        return 'Invalid NIP format. Expected exactly 10 digits.';

      case ERROR_CODES.MISSING_REQUIRED_FIELDS: {
        const fields = errors
          .filter((err) => this.isMissingFieldConstraint(err.constraint))
          .map((err) => err.property);

        const uniqueFields = [...new Set(fields)];

        if (uniqueFields.length === 1) {
          return `Required field is missing: ${uniqueFields[0]}`;
        } else if (uniqueFields.length > 1) {
          return `Required fields are missing: ${uniqueFields.join(', ')}`;
        }

        return 'Required fields are missing from the request.';
      }

      case ERROR_CODES.INVALID_REQUEST_FORMAT: {
        // Check if this is whitelist validation error
        const whitelistError = errors.find((err) =>
          err.constraint.toLowerCase().includes('whitelist'),
        );

        if (whitelistError) {
          const extraFields = errors
            .filter((err) => err.constraint.toLowerCase().includes('whitelist'))
            .map((err) => err.property);

          const uniqueFields = [...new Set(extraFields)];
          return `Invalid request format. Unexpected fields: ${uniqueFields.join(', ')}`;
        }

        return 'Invalid request format.';
      }

      default:
        return 'Validation failed.';
    }
  }
}
