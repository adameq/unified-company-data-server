import { soap } from 'strong-soap';
import type { GusSoapClient } from '../gus-soap-client.facade';

/**
 * GUS Session representation
 *
 * Represents an active GUS SOAP session with:
 * - sessionId: Unique session identifier from GUS API
 * - expiresAt: Session expiration timestamp
 * - soapClient: Facade for SOAP operations with automatic header injection
 * - rawClient: Underlying strong-soap client (for internal use only)
 */
export interface GusSession {
  sessionId: string;
  expiresAt: Date;
  soapClient: GusSoapClient;
  rawClient: soap.Client;
}

/**
 * GUS Configuration for SessionManager
 *
 * Contains all necessary configuration for creating and managing GUS sessions:
 * - baseUrl: GUS SOAP endpoint URL
 * - wsdlUrl: WSDL definition URL
 * - userKey: GUS API user key for authentication
 * - sessionTimeoutMs: Session timeout in milliseconds (default 30 minutes)
 */
export interface GusConfig {
  baseUrl: string;
  wsdlUrl: string;
  userKey: string;
  sessionTimeoutMs: number;
}
