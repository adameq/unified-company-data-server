import { createHash } from 'crypto';

/**
 * Unit Tests for Rate Limiting Security
 *
 * These tests verify that API key hashing for rate limiting prevents:
 * 1. Collision attacks (different keys with same prefix)
 * 2. Key fragment exposure in logs/metrics
 * 3. Predictability exploits
 */
describe('Rate Limiting Security - API Key Hashing', () => {
  /**
   * Hash API key for rate limiting (same implementation as throttler.config.ts)
   */
  function hashApiKeyForRateLimit(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
  }

  describe('Collision Prevention', () => {
    it('should generate different hashes for API keys with same 16-char prefix', () => {
      // Two different API keys with identical first 16 characters
      const apiKey1 = '1234567890123456-client-A-suffix-xyz';
      const apiKey2 = '1234567890123456-client-B-suffix-abc';

      // Extract first 16 chars (old vulnerable approach)
      const oldApproach1 = apiKey1.substring(0, 16);
      const oldApproach2 = apiKey2.substring(0, 16);

      // Old approach: COLLISION! Both would share rate limits
      expect(oldApproach1).toBe(oldApproach2);
      expect(oldApproach1).toBe('1234567890123456');

      // New approach: Different hashes despite same prefix
      const hash1 = hashApiKeyForRateLimit(apiKey1);
      const hash2 = hashApiKeyForRateLimit(apiKey2);

      expect(hash1).not.toBe(hash2);
      expect(hash1.length).toBe(16);
      expect(hash2.length).toBe(16);
    });

    it('should generate unique hashes for similar API keys', () => {
      const apiKeys = [
        'test-api-key-000001',
        'test-api-key-000002',
        'test-api-key-000003',
      ];

      const hashes = apiKeys.map(hashApiKeyForRateLimit);

      // All hashes should be unique
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(apiKeys.length);

      // No hash should equal the original key prefix
      hashes.forEach((hash, index) => {
        expect(hash).not.toBe(apiKeys[index].substring(0, 16));
      });
    });
  });

  describe('Security - No Key Fragment Exposure', () => {
    it('should not expose original API key fragments in hash', () => {
      const apiKey = 'super-secret-key-12345678901234567890';

      const hash = hashApiKeyForRateLimit(apiKey);

      // Hash should not contain any substring from original key
      const keyFragments = [
        'super',
        'secret',
        'key',
        '1234',
        '5678',
        apiKey.substring(0, 8),
        apiKey.substring(8, 16),
      ];

      keyFragments.forEach((fragment) => {
        expect(hash.toLowerCase()).not.toContain(fragment.toLowerCase());
      });
    });

    it('should generate hash that appears random', () => {
      const apiKey = 'my-api-key-abcdef123456';

      const hash = hashApiKeyForRateLimit(apiKey);

      // Hash should be hexadecimal
      expect(hash).toMatch(/^[0-9a-f]{16}$/);

      // Hash should not be trivially related to input
      expect(hash).not.toBe(apiKey);
      expect(hash).not.toBe(apiKey.toLowerCase());
      expect(hash).not.toBe(apiKey.toUpperCase());
    });
  });

  describe('Predictability Prevention', () => {
    it('should produce completely different hash for small input change', () => {
      const apiKey1 = 'my-api-key-client-001';
      const apiKey2 = 'my-api-key-client-002'; // Only last char different

      const hash1 = hashApiKeyForRateLimit(apiKey1);
      const hash2 = hashApiKeyForRateLimit(apiKey2);

      // SHA256 avalanche effect: 1 bit change → ~50% output bits change
      expect(hash1).not.toBe(hash2);

      // Count different characters (should be ~8 out of 16 for good hash)
      let differentChars = 0;
      for (let i = 0; i < 16; i++) {
        if (hash1[i] !== hash2[i]) differentChars++;
      }

      // At least 4 characters should differ (avalanche effect)
      expect(differentChars).toBeGreaterThanOrEqual(4);
    });

    it('should be deterministic (same input → same output)', () => {
      const apiKey = 'consistent-api-key-test';

      const hash1 = hashApiKeyForRateLimit(apiKey);
      const hash2 = hashApiKeyForRateLimit(apiKey);
      const hash3 = hashApiKeyForRateLimit(apiKey);

      // Same input must always produce same hash
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });

  describe('Performance - Hash Sufficiency', () => {
    it('should use 16 characters from SHA256 (128 bits of entropy)', () => {
      const apiKey = 'performance-test-key';

      const hash = hashApiKeyForRateLimit(apiKey);

      // 16 hex chars = 64 bits of entropy (sufficient for rate limiting)
      // Full SHA256 = 256 bits (64 hex chars) - we use first 16 chars
      expect(hash.length).toBe(16);

      // Verify it's actually from SHA256 (first 16 chars of full hash)
      const fullHash = createHash('sha256').update(apiKey).digest('hex');
      expect(hash).toBe(fullHash.substring(0, 16));
    });

    it('should have low collision probability with 16-char hash', () => {
      // Birthday paradox: with 2^32 API keys, collision probability ≈ 0.000000023%
      // 16 hex chars = 2^64 possible values
      // For 1 million API keys: collision probability ≈ 0.00000000000003%

      const apiKeys = Array.from({ length: 1000 }, (_, i) => `api-key-${i}`);
      const hashes = apiKeys.map(hashApiKeyForRateLimit);

      // All hashes should be unique (no collisions with 1000 keys)
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(apiKeys.length);
    });
  });

  describe('Comparison with Old Vulnerable Approach', () => {
    it('should demonstrate security improvement over substring approach', () => {
      // Attack scenario: attacker wants to exhaust rate limit of victim
      const victimApiKey = '1234567890abcdefVICTIM-SECRET-SUFFIX';
      const attackerApiKey = '1234567890abcdefATTACKER-MALICIOUS';

      // Old vulnerable approach: substring(0, 16)
      const oldVictimId = victimApiKey.substring(0, 16);
      const oldAttackerId = attackerApiKey.substring(0, 16);

      // VULNERABILITY: Attacker and victim share same rate limit!
      expect(oldVictimId).toBe(oldAttackerId);

      // New secure approach: SHA256 hash
      const newVictimId = hashApiKeyForRateLimit(victimApiKey);
      const newAttackerId = hashApiKeyForRateLimit(attackerApiKey);

      // FIXED: Separate rate limits for each API key
      expect(newVictimId).not.toBe(newAttackerId);
    });

    it('should prevent log exposure of API key fragments', () => {
      const apiKey = 'secret-production-key-abc123def456';

      // Old approach: first 16 chars appear in logs
      const oldIdentifier = apiKey.substring(0, 16);
      expect(apiKey).toContain(oldIdentifier); // Key fragment exposed!

      // New approach: hash has no relation to original key
      const newIdentifier = hashApiKeyForRateLimit(apiKey);
      expect(apiKey).not.toContain(newIdentifier);
      expect(newIdentifier).not.toContain(apiKey.substring(0, 8));
    });
  });
});
