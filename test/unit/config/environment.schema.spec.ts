import { EnvironmentSchema } from '../../../src/config/environment.schema';

describe('EnvironmentSchema', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Development Environment', () => {
    it('should allow default API URLs in development', () => {
      const config = {
        NODE_ENV: 'development',
        PORT: '3000',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
      };

      // Should not throw - development allows default URLs
      const result = EnvironmentSchema.parse(config);

      expect(result.NODE_ENV).toBe('development');
      expect(result.GUS_BASE_URL).toBeDefined(); // Uses default
      expect(result.KRS_BASE_URL).toBeDefined(); // Uses default
      expect(result.CEIDG_BASE_URL).toBeDefined(); // Uses default
    });

    it('should allow APP_CORS_ALLOWED_ORIGINS="*" in development', () => {
      const config = {
        NODE_ENV: 'development',
        PORT: '3000',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: '*',
      };

      // Should not throw - development allows wildcard CORS
      const result = EnvironmentSchema.parse(config);

      expect(result.APP_CORS_ALLOWED_ORIGINS).toEqual(['*']);
    });

    it('should parse comma-separated CORS origins correctly', () => {
      const config = {
        NODE_ENV: 'development',
        PORT: '3000',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: 'http://localhost:3000, http://localhost:5173 , http://127.0.0.1:3000',
      };

      const result = EnvironmentSchema.parse(config);

      expect(result.APP_CORS_ALLOWED_ORIGINS).toEqual([
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
      ]);
    });

    it('should use default values for optional fields', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
      };

      const result = EnvironmentSchema.parse(config);

      expect(result.PORT).toBe(3000);
      expect(result.APP_REQUEST_TIMEOUT).toBe(15000);
      expect(result.APP_EXTERNAL_API_TIMEOUT).toBe(5000);
      expect(result.APP_RATE_LIMIT_PER_MINUTE).toBe(100);
      expect(result.APP_LOG_LEVEL).toBe('info');
      expect(result.GUS_MAX_RETRIES).toBe(2);
      expect(result.KRS_MAX_RETRIES).toBe(2);
      expect(result.CEIDG_MAX_RETRIES).toBe(2);
    });
  });

  describe('Production Environment - Success Cases', () => {
    beforeEach(() => {
      // Set process.env to simulate explicit configuration
      process.env.GUS_BASE_URL = 'https://production.gus.gov.pl';
      process.env.GUS_WSDL_URL = 'https://production.gus.gov.pl/wsdl';
      process.env.KRS_BASE_URL = 'https://production.krs.gov.pl';
      process.env.CEIDG_BASE_URL = 'https://production.ceidg.gov.pl';
    });

    it('should accept production config with explicit API URLs', () => {
      const config = {
        NODE_ENV: 'production',
        PORT: '8080',
        GUS_USER_KEY: 'prod_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'prod_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'prod_api_key_1234567890abcdef1234567890abcdef,backup_key_abcdefghijklmnopqrstuvwxyz123456',
        APP_CORS_ALLOWED_ORIGINS: 'https://app.example.com,https://www.example.com',
        GUS_BASE_URL: 'https://production.gus.gov.pl',
        GUS_WSDL_URL: 'https://production.gus.gov.pl/wsdl',
        KRS_BASE_URL: 'https://production.krs.gov.pl',
        CEIDG_BASE_URL: 'https://production.ceidg.gov.pl',
      };

      const result = EnvironmentSchema.parse(config);

      expect(result.NODE_ENV).toBe('production');
      expect(result.GUS_BASE_URL).toBe('https://production.gus.gov.pl');
      expect(result.APP_CORS_ALLOWED_ORIGINS).toEqual([
        'https://app.example.com',
        'https://www.example.com',
      ]);
    });

    it('should parse multiple API keys in production', () => {
      const config = {
        NODE_ENV: 'production',
        GUS_USER_KEY: 'prod_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'prod_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'key1_1234567890abcdef1234567890abcdef,key2_abcdefghijklmnopqrstuvwxyz123456,key3_zyxwvutsrqponmlkjihgfedcba987654',
        APP_CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        GUS_BASE_URL: 'https://production.gus.gov.pl',
        GUS_WSDL_URL: 'https://production.gus.gov.pl/wsdl',
        KRS_BASE_URL: 'https://production.krs.gov.pl',
        CEIDG_BASE_URL: 'https://production.ceidg.gov.pl',
      };

      const result = EnvironmentSchema.parse(config);

      expect(result.APP_API_KEYS).toHaveLength(3);
      expect(result.APP_API_KEYS[0]).toBe('key1_1234567890abcdef1234567890abcdef');
    });
  });

  describe('Production Environment - Fail Cases', () => {
    it('should throw error when using default GUS_BASE_URL in production', () => {
      const config = {
        NODE_ENV: 'production',
        GUS_USER_KEY: 'prod_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'prod_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'prod_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        // Missing: GUS_BASE_URL, GUS_WSDL_URL, KRS_BASE_URL, CEIDG_BASE_URL
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow(
        'Production environment detected with default API URLs',
      );
      expect(() => EnvironmentSchema.parse(config)).toThrow('GUS_BASE_URL');
      expect(() => EnvironmentSchema.parse(config)).toThrow('security risk');
    });

    it('should throw error when using default KRS_BASE_URL in production', () => {
      process.env.GUS_BASE_URL = 'https://production.gus.gov.pl';
      process.env.GUS_WSDL_URL = 'https://production.gus.gov.pl/wsdl';
      process.env.CEIDG_BASE_URL = 'https://production.ceidg.gov.pl';
      // Missing: KRS_BASE_URL

      const config = {
        NODE_ENV: 'production',
        GUS_USER_KEY: 'prod_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'prod_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'prod_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        GUS_BASE_URL: 'https://production.gus.gov.pl',
        GUS_WSDL_URL: 'https://production.gus.gov.pl/wsdl',
        CEIDG_BASE_URL: 'https://production.ceidg.gov.pl',
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow(
        'Production environment detected with default API URLs',
      );
      expect(() => EnvironmentSchema.parse(config)).toThrow('KRS_BASE_URL');
    });

    it('should throw error for APP_CORS_ALLOWED_ORIGINS="*" in production', () => {
      process.env.GUS_BASE_URL = 'https://production.gus.gov.pl';
      process.env.GUS_WSDL_URL = 'https://production.gus.gov.pl/wsdl';
      process.env.KRS_BASE_URL = 'https://production.krs.gov.pl';
      process.env.CEIDG_BASE_URL = 'https://production.ceidg.gov.pl';

      const config = {
        NODE_ENV: 'production',
        GUS_USER_KEY: 'prod_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'prod_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'prod_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: '*', // ❌ Not allowed in production
        GUS_BASE_URL: 'https://production.gus.gov.pl',
        GUS_WSDL_URL: 'https://production.gus.gov.pl/wsdl',
        KRS_BASE_URL: 'https://production.krs.gov.pl',
        CEIDG_BASE_URL: 'https://production.ceidg.gov.pl',
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow(
        'APP_CORS_ALLOWED_ORIGINS',
      );
      expect(() => EnvironmentSchema.parse(config)).toThrow('CSRF vulnerability');
    });

    it('should throw error when all default API URLs are used in production', () => {
      const config = {
        NODE_ENV: 'production',
        GUS_USER_KEY: 'prod_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'prod_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'prod_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: 'https://app.example.com',
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow();
      expect(() => EnvironmentSchema.parse(config)).toThrow('GUS_BASE_URL');
      expect(() => EnvironmentSchema.parse(config)).toThrow('GUS_WSDL_URL');
      expect(() => EnvironmentSchema.parse(config)).toThrow('KRS_BASE_URL');
      expect(() => EnvironmentSchema.parse(config)).toThrow('CEIDG_BASE_URL');
    });
  });

  describe('Required Fields Validation', () => {
    it('should throw error when GUS_USER_KEY is missing', () => {
      const config = {
        NODE_ENV: 'development',
        // Missing: GUS_USER_KEY
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow();
    });

    it('should throw error when CEIDG_JWT_TOKEN is missing', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        // Missing: CEIDG_JWT_TOKEN
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow();
    });

    it('should use default APP_API_KEYS when not provided', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        // Missing: APP_API_KEYS - should use default value
      };

      const result = EnvironmentSchema.parse(config);
      expect(result.APP_API_KEYS).toEqual(['dev_api_key_1234567890abcdef1234567890abcdef']);
    });

    it('should throw error when API key is shorter than 32 characters', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'short_key', // ❌ Less than 32 chars
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow(
        'Each API key must be at least 32 characters',
      );
    });

    it('should throw error when one of multiple API keys is too short', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'valid_key_1234567890abcdef1234567890abcdef,short', // Second key too short
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow(
        'Each API key must be at least 32 characters',
      );
    });
  });

  describe('Type Coercion and Defaults', () => {
    it('should coerce PORT from string to number', () => {
      const config = {
        NODE_ENV: 'development',
        PORT: '8080', // String input
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
      };

      const result = EnvironmentSchema.parse(config);

      expect(result.PORT).toBe(8080);
      expect(typeof result.PORT).toBe('number');
    });

    it('should use default boolean values when not provided', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
        // Not providing HEALTH_CHECK_ENABLED, SWAGGER_ENABLED
      };

      const result = EnvironmentSchema.parse(config);

      // Should use defaults
      expect(result.APP_HEALTH_CHECK_ENABLED).toBe(true);
      expect(result.APP_SWAGGER_ENABLED).toBe(true);
    });

    it('should enforce PORT range constraints', () => {
      const configLow = {
        NODE_ENV: 'development',
        PORT: '0', // ❌ Below minimum
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
      };

      expect(() => EnvironmentSchema.parse(configLow)).toThrow();

      const configHigh = {
        NODE_ENV: 'development',
        PORT: '99999', // ❌ Above maximum
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
      };

      expect(() => EnvironmentSchema.parse(configHigh)).toThrow();
    });

    it('should enforce retry configuration constraints', () => {
      const config = {
        NODE_ENV: 'development',
        GUS_USER_KEY: 'test_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'test_jwt_1234567890123456789012345678901234567890123456',
        APP_API_KEYS: 'dev_api_key_1234567890abcdef1234567890abcdef',
        GUS_MAX_RETRIES: '10', // ❌ Above maximum (5)
      };

      expect(() => EnvironmentSchema.parse(config)).toThrow();
    });
  });

  describe('Staging Environment', () => {
    it('should accept staging environment similar to development', () => {
      const config = {
        NODE_ENV: 'staging',
        GUS_USER_KEY: 'staging_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'staging_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'staging_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: 'https://staging.example.com',
      };

      const result = EnvironmentSchema.parse(config);

      expect(result.NODE_ENV).toBe('staging');
      // Staging allows default URLs (same as development)
      expect(result.GUS_BASE_URL).toBeDefined();
    });

    it('should allow CORS wildcard in staging', () => {
      const config = {
        NODE_ENV: 'staging',
        GUS_USER_KEY: 'staging_key_12345678901234567890',
        CEIDG_JWT_TOKEN: 'staging_jwt_1234567890123456789012345678901234567890123456',
        VALID_API_KEYS: 'staging_api_key_1234567890abcdef1234567890abcdef',
        APP_CORS_ALLOWED_ORIGINS: '*',
      };

      // Should not throw - staging is not production
      const result = EnvironmentSchema.parse(config);
      expect(result.APP_CORS_ALLOWED_ORIGINS).toEqual(['*']);
    });
  });
});
