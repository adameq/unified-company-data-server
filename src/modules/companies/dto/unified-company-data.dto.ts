import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for address information
 */
export class AddressDto {
  @ApiProperty({
    description: 'Province/Voivodeship name',
    example: 'mazowieckie',
    nullable: true,
    required: false,
  })
  wojewodztwo?: string | null;

  @ApiProperty({
    description: 'District/County name',
    example: 'warszawa',
    nullable: true,
    required: false,
  })
  powiat?: string | null;

  @ApiProperty({
    description: 'Municipality/Commune name',
    example: 'Warszawa',
    nullable: true,
    required: false,
  })
  gmina?: string | null;

  @ApiProperty({
    description: 'City or locality name',
    example: 'Warszawa',
  })
  miejscowosc!: string;

  @ApiProperty({
    description: 'Postal code in XX-XXX format',
    example: '00-001',
    pattern: '^\\d{2}-\\d{3}$',
  })
  kodPocztowy!: string;

  @ApiProperty({
    description: 'Street name',
    example: 'ul. Przykładowa',
    nullable: true,
    required: false,
  })
  ulica?: string | null;

  @ApiProperty({
    description: 'Building number',
    example: '123',
    nullable: true,
    required: false,
  })
  numerBudynku?: string | null;

  @ApiProperty({
    description: 'Apartment/Office number',
    example: '45',
    nullable: true,
    required: false,
  })
  numerLokalu?: string | null;
}

/**
 * DTO for PKD (Polish Classification of Activities) code
 */
export class PkdDto {
  @ApiProperty({
    description: 'PKD classification code',
    example: '62.01.Z',
  })
  kod!: string;

  @ApiProperty({
    description: 'PKD activity description',
    example: 'Działalność związana z oprogramowaniem',
  })
  nazwa!: string;

  @ApiProperty({
    description: 'Whether this is the primary business activity',
    example: true,
  })
  czyGlowny!: boolean;
}

/**
 * DTO for unified company data response
 */
export class UnifiedCompanyDataDto {
  @ApiProperty({
    description: 'Polish NIP (Tax Identification Number)',
    example: '1234567890',
    pattern: '^\\d{10}$',
  })
  nip!: string;

  @ApiProperty({
    description: 'Company name',
    example: 'Przykładowa Firma S.A.',
  })
  nazwa!: string;

  @ApiProperty({
    description: 'Company address information',
    type: AddressDto,
  })
  adres!: AddressDto;

  @ApiProperty({
    description: 'Company status',
    example: 'AKTYWNY',
    enum: [
      'AKTYWNY',
      'WYKRESLONY',
      'ZAWIESZONY',
      'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI',
    ],
  })
  status!: string;

  @ApiProperty({
    description: 'Derived from status (AKTYWNY = true, others = false)',
    example: true,
  })
  isActive!: boolean;

  @ApiProperty({
    description: 'Business activity start date',
    example: '2020-01-15',
    format: 'date',
    nullable: true,
    required: false,
  })
  dataRozpoczeciaDzialalnosci?: string | null;

  @ApiProperty({
    description: 'List of PKD business activity codes',
    type: [PkdDto],
    nullable: true,
    required: false,
  })
  pkd?: PkdDto[] | null;

  @ApiProperty({
    description: 'Data source identifier',
    example: 'GUS',
    enum: ['GUS', 'KRS', 'CEIDG', 'MOCK'],
  })
  zrodloDanych!: string;

  @ApiProperty({
    description: 'Data last update timestamp',
    example: '2025-09-26T20:14:52.000Z',
    format: 'date-time',
  })
  dataAktualizacji!: string;

  @ApiProperty({
    description: 'REGON number (9 or 14 digits)',
    example: '123456789',
    nullable: true,
    required: false,
  })
  regon?: string | null;

  @ApiProperty({
    description: 'KRS (National Court Register) number',
    example: '0000123456',
    nullable: true,
    required: false,
  })
  krs?: string | null;

  @ApiProperty({
    description: 'Business activity end date (if applicable)',
    example: '2025-12-31',
    format: 'date',
    nullable: true,
    required: false,
  })
  dataZakonczeniaDzialalnosci?: string | null;

  @ApiProperty({
    description: 'Legal form of the company',
    example: 'SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
    nullable: true,
    required: false,
  })
  formaPrawna?: string | null;

  @ApiProperty({
    description: 'Entity type (legal person or natural person)',
    example: 'PRAWNA',
    enum: ['PRAWNA', 'FIZYCZNA'],
  })
  typPodmiotu!: string;

  @ApiProperty({
    description: 'Company share capital (if applicable)',
    example: 5000.0,
    type: 'number',
    format: 'decimal',
    nullable: true,
    required: false,
  })
  kapitalZakladowy?: number | null;
}
