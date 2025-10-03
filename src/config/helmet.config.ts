import helmet from 'helmet';
import { HelmetOptions } from 'helmet';

/**
 * Helmet Security Configuration for REST API
 *
 * Implements comprehensive HTTP security headers using Helmet.js middleware.
 * Follows OWASP Security Headers best practices for REST APIs.
 *
 * Key Security Headers:
 * - Content-Security-Policy (CSP): Prevents XSS, clickjacking, and code injection
 * - Strict-Transport-Security (HSTS): Forces HTTPS connections
 * - X-Frame-Options: Prevents clickjacking attacks
 * - X-Content-Type-Options: Prevents MIME sniffing
 * - Referrer-Policy: Controls referrer information leakage
 * - Cross-Origin-*-Policy: Protects against Spectre/Meltdown attacks
 *
 * CSP for REST APIs:
 * While CSP is primarily designed for browsers, it provides defense-in-depth
 * for API responses consumed by browser-based clients (Swagger UI, dev tools, etc.)
 *
 * References:
 * - Helmet.js: https://helmetjs.github.io/
 * - OWASP Security Headers: https://owasp.org/www-project-secure-headers/
 * - CSP for APIs: https://content-security-policy.com/
 */

/**
 * Restrictive Content Security Policy for REST API
 *
 * Default CSP directives designed for JSON API endpoints:
 * - Blocks all external resources by default
 * - Allows only same-origin resources
 * - Prevents inline scripts and styles
 * - Blocks all frames and embeds
 *
 * Note: Swagger UI may require additional CSP relaxation.
 * See `getHelmetConfigForSwagger()` for Swagger-specific CSP.
 */
const RESTRICTIVE_CSP_DIRECTIVES: helmet.ContentSecurityPolicyOptions['directives'] = {
  // Default policy: only same-origin resources
  defaultSrc: ["'self'"],

  // Scripts: only from same origin (blocks inline and eval)
  scriptSrc: ["'self'"],

  // Styles: only from same origin
  styleSrc: ["'self'"],

  // Images: same origin + data URLs (for inline images)
  imgSrc: ["'self'", 'data:'],

  // Fonts: only from same origin
  fontSrc: ["'self'"],

  // AJAX/WebSocket/EventSource: only same origin
  connectSrc: ["'self'"],

  // Media (audio/video): only same origin
  mediaSrc: ["'self'"],

  // Objects (Flash, Java applets): none
  objectSrc: ["'none'"],

  // Child contexts (iframes): none
  frameSrc: ["'none'"],

  // Ancestors (who can embed this): none (prevents clickjacking)
  frameAncestors: ["'none'"],

  // Forms: can only submit to same origin
  formAction: ["'self'"],

  // Base URI: only same origin (prevents base tag injection)
  baseUri: ["'self'"],

  // Worker scripts: only same origin
  workerSrc: ["'self'"],

  // Manifest: only same origin
  manifestSrc: ["'self'"],

  // Upgrade insecure requests to HTTPS
  upgradeInsecureRequests: [],
};

/**
 * Relaxed CSP for Swagger UI Documentation
 *
 * Swagger UI requires inline styles and specific external resources.
 * This configuration maintains security while allowing Swagger to function.
 */
const SWAGGER_CSP_DIRECTIVES: helmet.ContentSecurityPolicyOptions['directives'] = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"], // Swagger requires inline scripts
  styleSrc: ["'self'", "'unsafe-inline'"], // Swagger requires inline styles
  imgSrc: ["'self'", 'data:', 'https:'], // Swagger loads external images
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

/**
 * Production-grade Helmet configuration with all security headers
 *
 * Implements defense-in-depth strategy:
 * - CSP prevents XSS and injection attacks
 * - HSTS forces HTTPS connections (with preload for browsers)
 * - CORP/COEP/COOP protect against Spectre/Meltdown
 * - X-Frame-Options prevents clickjacking
 * - X-Content-Type-Options prevents MIME sniffing
 * - Referrer-Policy prevents information leakage
 *
 * All headers are enabled by default for maximum security.
 */
export const HELMET_CONFIG: HelmetOptions = {
  // Content Security Policy (CSP)
  contentSecurityPolicy: {
    directives: RESTRICTIVE_CSP_DIRECTIVES,
  },

  // Cross-Origin Embedder Policy (COEP)
  // Prevents loading cross-origin resources without explicit permission
  crossOriginEmbedderPolicy: true,

  // Cross-Origin Opener Policy (COOP)
  // Protects against Spectre-like attacks by isolating browsing contexts
  crossOriginOpenerPolicy: {
    policy: 'same-origin',
  },

  // Cross-Origin Resource Policy (CORP)
  // Prevents other origins from reading your resources
  crossOriginResourcePolicy: {
    policy: 'same-origin',
  },

  // DNS Prefetch Control
  // Prevents browser from prefetching DNS for external domains
  dnsPrefetchControl: {
    allow: false,
  },

  // X-Frame-Options (legacy support, CSP frame-ancestors is preferred)
  // Prevents page from being embedded in iframes (clickjacking protection)
  frameguard: {
    action: 'deny',
  },

  // Strict-Transport-Security (HSTS)
  // Forces HTTPS connections for 1 year, includes subdomains, enables preload
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true, // Submit to browsers' HSTS preload list
  },

  // X-Download-Options (IE-specific)
  // Prevents IE from executing downloads in site's context
  ieNoOpen: true,

  // X-Content-Type-Options
  // Prevents browsers from MIME-sniffing responses away from declared content-type
  noSniff: true,

  // Origin-Agent-Cluster
  // Requests that browser should isolate the origin from other origins
  originAgentCluster: true,

  // X-Permitted-Cross-Domain-Policies (Adobe Flash/PDF)
  // Blocks Adobe Flash/PDF from loading cross-domain content
  permittedCrossDomainPolicies: {
    permittedPolicies: 'none',
  },

  // Referrer-Policy
  // Prevents leaking referrer information to other sites
  referrerPolicy: {
    policy: 'no-referrer',
  },

  // X-XSS-Protection (legacy, CSP is preferred)
  // Enables browser's XSS filter (legacy browsers)
  xssFilter: true,
};

/**
 * Get Helmet configuration with optional Swagger-specific CSP
 *
 * When Swagger is enabled, uses relaxed CSP to allow Swagger UI to function.
 * Otherwise, uses restrictive CSP for maximum API security.
 *
 * @param swaggerEnabled - Whether Swagger documentation is enabled
 * @returns Helmet configuration object
 */
export function getHelmetConfig(swaggerEnabled: boolean): HelmetOptions {
  if (swaggerEnabled) {
    return {
      ...HELMET_CONFIG,
      contentSecurityPolicy: {
        directives: SWAGGER_CSP_DIRECTIVES,
      },
    };
  }

  return HELMET_CONFIG;
}

/**
 * Get human-readable summary of enabled Helmet security features
 *
 * Used for logging during application startup to confirm security headers.
 *
 * @returns Object with security feature flags
 */
export function getHelmetSecuritySummary() {
  return {
    csp: 'Enabled (restrictive default-src self)',
    hsts: 'Enabled (1 year, includeSubDomains, preload)',
    frameOptions: 'DENY (clickjacking protection)',
    contentTypeOptions: 'nosniff (MIME sniffing protection)',
    referrerPolicy: 'no-referrer (information leakage protection)',
    crossOriginPolicies: 'same-origin (Spectre/Meltdown protection)',
    xssFilter: 'Enabled (legacy browser protection)',
  };
}
