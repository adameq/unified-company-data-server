import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for error response
 */
export class ErrorResponseDto {
  @ApiProperty({
    description: 'Standardized error code',
    example: 'INVALID_NIP_FORMAT',
    enum: [
      'INVALID_NIP_FORMAT',
      'INVALID_REQUEST_FORMAT',
      'MISSING_REQUIRED_FIELDS',
      'INVALID_API_KEY',
      'MISSING_API_KEY',
      'ENTITY_NOT_FOUND',
      'ENTITY_DEREGISTERED',
      'TIMEOUT_ERROR',
      'CLASSIFICATION_FAILED',
      'DATA_MAPPING_FAILED',
      'RATE_LIMIT_EXCEEDED',
      'GUS_SERVICE_UNAVAILABLE',
      'KRS_SERVICE_UNAVAILABLE',
      'CEIDG_SERVICE_UNAVAILABLE',
      'SERVICE_DEGRADED',
      'INTERNAL_SERVER_ERROR',
    ],
  })
  errorCode!: string;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Invalid NIP format: 123. Expected 10 digits.',
  })
  message!: string;

  @ApiProperty({
    description: 'Unique request correlation ID for tracking',
    example: 'req-1758914092756-j57tbg1gn',
  })
  correlationId!: string;

  @ApiProperty({
    description: 'Error source system',
    example: 'INTERNAL',
    enum: ['INTERNAL', 'GUS', 'KRS', 'CEIDG'],
  })
  source!: string;

  @ApiProperty({
    description: 'Error timestamp in ISO format',
    example: '2025-09-26T20:14:52.756Z',
    format: 'date-time',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'Additional error details (optional)',
    example: {
      validationErrors: [
        {
          code: 'invalid_string',
          expected: 'string',
          received: 'number',
          path: ['nip'],
          message: 'Expected string, received number',
        },
      ],
    },
    required: false,
  })
  details?: Record<string, any>;
}
