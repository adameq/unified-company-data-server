import { GusHeaderManager } from '../../../src/modules/external-apis/gus/gus-header.manager';
import { GusSessionManager } from '../../../src/modules/external-apis/gus/gus-session.manager';
import type { GusConfig } from '../../../src/modules/external-apis/gus/interfaces/gus-session.interface';

/**
 * Unit tests for GusHeaderManager
 *
 * Tests header management for GUS SOAP operations:
 * - Operation name to WS-Addressing Action mapping
 * - HTTP header (sid) injection
 * - SOAP header (WS-Addressing) injection
 *
 * Note: These tests focus on header construction logic.
 * Full SOAP integration is tested in integration tests.
 */

describe('GusHeaderManager', () => {
  let headerManager: GusHeaderManager;
  let sessionManager: GusSessionManager;
  let mockConfig: GusConfig;

  beforeEach(() => {
    mockConfig = {
      baseUrl: 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
      wsdlUrl: 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/wsdl/UslugaBIRzewnPubl-ver11-test.wsdl',
      userKey: 'd235b29b4a284c3d89ab',
      sessionTimeoutMs: 30 * 60 * 1000,
    };
    sessionManager = new GusSessionManager(mockConfig);
    headerManager = new GusHeaderManager(sessionManager, mockConfig);
  });

  describe('Operation Mapping', () => {
    test('should have correct WS-Addressing Action for Zaloguj', () => {
      const expectedAction = 'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj';
      // Access private property for testing (TypeScript workaround)
      const actions = (headerManager as any).OPERATION_ACTIONS;
      expect(actions.Zaloguj).toBe(expectedAction);
    });

    test('should have correct WS-Addressing Action for DaneSzukajPodmioty', () => {
      const expectedAction = 'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty';
      const actions = (headerManager as any).OPERATION_ACTIONS;
      expect(actions.DaneSzukajPodmioty).toBe(expectedAction);
    });

    test('should have correct WS-Addressing Action for DanePobierzPelnyRaport', () => {
      const expectedAction = 'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DanePobierzPelnyRaport';
      const actions = (headerManager as any).OPERATION_ACTIONS;
      expect(actions.DanePobierzPelnyRaport).toBe(expectedAction);
    });

    test('should have correct WS-Addressing Action for Wyloguj', () => {
      const expectedAction = 'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Wyloguj';
      const actions = (headerManager as any).OPERATION_ACTIONS;
      expect(actions.Wyloguj).toBe(expectedAction);
    });

    test('should have all required operations mapped', () => {
      const actions = (headerManager as any).OPERATION_ACTIONS;
      const requiredOperations = [
        'Zaloguj',
        'DaneSzukajPodmioty',
        'DanePobierzPelnyRaport',
        'Wyloguj',
      ];

      requiredOperations.forEach(operation => {
        expect(actions[operation]).toBeDefined();
        expect(typeof actions[operation]).toBe('string');
        expect(actions[operation]).toContain('http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/');
      });
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
      const testHeaderManager = new GusHeaderManager(manager, config);
      expect(testHeaderManager).toBeDefined();
    });

    test('should use WS-Addressing namespace', () => {
      const namespace = (headerManager as any).WS_ADDRESSING_NS;
      expect(namespace).toBe('http://www.w3.org/2005/08/addressing');
    });
  });

  /**
   * Note: Full header injection, SOAP client integration, and request lifecycle
   * are tested in integration tests (tests/integration/companies-success.spec.ts)
   * because they require real SOAP client and GUS API interaction.
   */
});
