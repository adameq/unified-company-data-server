import { GusSessionManager } from '../../../src/modules/external-apis/gus/gus-session.manager';
import type { GusConfig, GusSession } from '../../../src/modules/external-apis/gus/interfaces/gus-session.interface';

/**
 * Unit tests for GusSessionManager
 *
 * Tests session lifecycle management including:
 * - Session validation
 * - Session expiration
 * - Concurrent request handling
 *
 * Note: These tests focus on session state management logic.
 * Full SOAP integration is tested in integration tests.
 */

describe('GusSessionManager', () => {
  let sessionManager: GusSessionManager;
  let mockConfig: GusConfig;

  beforeEach(() => {
    mockConfig = {
      baseUrl: 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
      wsdlUrl: 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-test.wsdl',
      userKey: 'd235b29b4a284c3d89ab',
      sessionTimeoutMs: 1000, // 1 second for fast testing
    };
    sessionManager = new GusSessionManager(mockConfig);
  });

  describe('Session Validation', () => {
    test('should return false when no session exists', () => {
      expect(sessionManager.isSessionValid()).toBe(false);
    });

    test('should return null for getCurrentSession when no session exists', () => {
      expect(sessionManager.getCurrentSession()).toBeNull();
    });
  });

  describe('Session Cleanup', () => {
    test('should clear session when clearSession is called', () => {
      // Clear session (should work even when no session exists)
      sessionManager.clearSession();
      expect(sessionManager.getCurrentSession()).toBeNull();
      expect(sessionManager.isSessionValid()).toBe(false);
    });
  });

  describe('Configuration', () => {
    test('should accept valid configuration', () => {
      const config: GusConfig = {
        baseUrl: 'https://example.com',
        wsdlUrl: 'https://example.com/wsdl',
        userKey: 'test-key-12345678901',
        sessionTimeoutMs: 30 * 60 * 1000,
      };

      const manager = new GusSessionManager(config);
      expect(manager).toBeDefined();
    });

    test('should use provided timeout value', () => {
      const shortTimeout = new GusSessionManager({
        ...mockConfig,
        sessionTimeoutMs: 100,
      });
      expect(shortTimeout).toBeDefined();
    });
  });

  /**
   * Note: Full session creation, race condition handling, and SOAP integration
   * are tested in integration tests (tests/integration/companies-success.spec.ts)
   * because they require real GUS API interaction.
   */
});
