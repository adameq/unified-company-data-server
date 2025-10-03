import {
  ValidationPipe,
  BadRequestException,
  ArgumentMetadata,
  ValidationPipeOptions,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ValidationExceptionFactory } from '../factories/validation-exception.factory';
import { ValidationException } from '../exceptions/validation.exception';

/**
 * AppValidationPipe
 *
 * Custom ValidationPipe that ensures ALL validation errors (including whitelist violations)
 * are converted to structured ValidationException using our custom factory.
 *
 * Problem solved:
 * - NestJS ValidationPipe has two execution paths:
 *   1. Normal validation (DTO decorators) → calls exceptionFactory
 *   2. Whitelist validation (forbidNonWhitelisted) → throws BadRequestException directly
 *
 * - This causes inconsistent error handling - some errors are ValidationException,
 *   others are BadRequestException with array messages (internal NestJS structure)
 *
 * Solution:
 * - Constructor wraps options.exceptionFactory with ValidationExceptionFactory.create
 * - Override transform() to catch whitelist BadRequestException and convert to ValidationException
 * - Ensures ALL validation errors follow the same structured format
 *
 * Benefits:
 * - No dependency on NestJS internal response structure
 * - No string parsing in exception handlers
 * - All validation errors have consistent format (ValidationException)
 * - Future-proof against NestJS version changes
 *
 * Usage (in main.ts):
 * ```typescript
 * app.useGlobalPipes(
 *   new AppValidationPipe({
 *     whitelist: true,
 *     forbidNonWhitelisted: true,
 *     transform: true,
 *     stopAtFirstError: false,
 *   }),
 * );
 * ```
 */
export class AppValidationPipe extends ValidationPipe {
  constructor(options?: ValidationPipeOptions) {
    // Merge options with custom exceptionFactory
    const mergedOptions: ValidationPipeOptions = {
      ...options,
      exceptionFactory: (errors: ValidationError[]) => {
        if (!errors || errors.length === 0) {
          return new BadRequestException('Validation failed');
        }
        return ValidationExceptionFactory.create(errors);
      },
    };

    super(mergedOptions);
  }

  /**
   * Override transform to catch whitelist violations and convert to ValidationException
   *
   * ValidationPipe's whitelist validation throws BadRequestException before calling
   * exceptionFactory. We catch it here and convert to structured ValidationException.
   */
  async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      // Check if this is a whitelist violation (BadRequestException from ValidationPipe)
      if (
        error instanceof BadRequestException &&
        this.isWhitelistViolation(error)
      ) {
        // Convert to structured ValidationException
        throw this.createWhitelistException(error);
      }

      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Check if BadRequestException is from whitelist validation
   *
   * ValidationPipe throws BadRequestException with array messages for whitelist violations.
   * Message format: ["property {fieldName} should not exist"]
   */
  private isWhitelistViolation(error: BadRequestException): boolean {
    const response = error.getResponse();

    if (typeof response !== 'object' || response === null) {
      return false;
    }

    if (!('message' in response) || !Array.isArray(response.message)) {
      return false;
    }

    // Check if any message indicates whitelist violation
    return response.message.some(
      (msg: any) =>
        typeof msg === 'string' &&
        msg.toLowerCase().includes('should not exist'),
    );
  }

  /**
   * Create ValidationException from whitelist violation
   *
   * Extracts field names from whitelist violation messages and creates
   * structured ValidationException with INVALID_REQUEST_FORMAT error code.
   */
  private createWhitelistException(
    error: BadRequestException,
  ): ValidationException {
    const response = error.getResponse() as { message: string[] };
    const messages = response.message;

    // Extract field names from messages like "property fieldName should not exist"
    const fieldNames = messages
      .map((msg) => {
        const match = msg.match(/property (\w+)/i);
        return match ? match[1] : null;
      })
      .filter((name): name is string => name !== null);

    // Create ValidationError objects for ValidationExceptionFactory
    const validationErrors: ValidationError[] = fieldNames.map((fieldName) => {
      const error = new ValidationError();
      error.property = fieldName;
      error.value = undefined;
      error.constraints = {
        whitelistValidation: `property ${fieldName} should not exist`,
      };
      return error;
    });

    // Use ValidationExceptionFactory to create structured exception
    return ValidationExceptionFactory.create(validationErrors);
  }
}
