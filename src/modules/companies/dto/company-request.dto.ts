import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, IsNotEmpty } from 'class-validator';

/**
 * DTO for company data request
 *
 * Validation strategy:
 * - Uses class-validator decorators for validation
 * - Validated by ValidationPipe in main.ts
 * - Errors transformed by GlobalExceptionFilter to ErrorResponse format
 */
export class CompanyRequestDto {
  @ApiProperty({
    description: 'Polish NIP (Tax Identification Number) - exactly 10 digits',
    example: '1234567890',
    pattern: '^\\d{10}$',
    minLength: 10,
    maxLength: 10,
    required: true,
  })
  @IsNotEmpty({ message: 'NIP is required' })
  @IsString({ message: 'NIP must be a string' })
  @Matches(/^\d{10}$/, {
    message: 'NIP must be exactly 10 digits',
  })
  nip!: string;
}
