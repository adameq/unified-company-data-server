import { soap } from 'strong-soap';

/**
 * GUS Session representation
 *
 * Represents an active GUS SOAP session with:
 * - sessionId: Unique session identifier from GUS API
 * - expiresAt: Session expiration timestamp
 * - client: strong-soap SOAP client with active session
 */
export interface GusSession {
  sessionId: string;
  expiresAt: Date;
  client: soap.Client;
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
