import { z } from 'zod';
import { UnifiedCompanyDataSchema } from './unified-company-data.schema';
import type { GusClassificationResponse } from '../modules/external-apis/gus/gus.service';
import {
  GusClassificationResponseSchema,
  GusLegalPersonReportSchema,
  GusPhysicalPersonReportSchema,
} from '../modules/external-apis/gus/validators/gus-response.validator';
import { KrsResponseSchema } from '../modules/external-apis/krs/schemas/krs-response.schema';
import { CeidgCompanySchema } from '../modules/external-apis/ceidg/schemas/ceidg-response.schema';

/**
 * Zod schema for internal state management for XState orchestration machine
 * Based on data-model.md specification
 *
 * Source: Created and maintained by state machine during request processing
 */

// Company classification sub-schema
const CompanyClassificationSchema = z
  .object({
    silosId: z.string().describe('GUS silo identifier'),

    regon: z
      .string()
      .regex(/^\d{9}(\d{5})?$/, 'Must be 9 or 14 digits')
      .describe('REGON from classification'),

    typ: z.string().describe('Entity type from GUS'),

    // Derived routing flags for convenience (auto-calculated from silosId)
    requiresKrs: z
      .boolean()
      .optional()
      .describe('True if silosId = 6 (legal entities)'),

    requiresCeidg: z
      .boolean()
      .optional()
      .describe('True if silosId = 1 (individual entrepreneurs)'),

    isDeregistered: z
      .boolean()
      .optional()
      .describe('True if silosId = 4 (deregistered entities)'),
  })
  .transform((data) => ({
    ...data,
    requiresKrs: data.silosId === '6',
    requiresCeidg: data.silosId === '1',
    isDeregistered: data.silosId === '4',
  }));

// Last error sub-schema
const LastErrorSchema = z.object({
  errorCode: z.string().describe('Standardized error code'),

  message: z.string().describe('Error description'),

  source: z.enum(['GUS', 'KRS', 'CEIDG', 'INTERNAL']).describe('Error origin'),

  originalError: z
    .any()
    .optional()
    .describe('Original error object for logging'),

  timestamp: z
    .string()
    .datetime()
    .default(() => new Date().toISOString())
    .describe('When the error occurred (ISO 8601 format)'),
});

// Retry count tracking schema
const RetryCountSchema = z.record(z.string(), z.number().min(0));

// Main OrchestrationContext schema
export const OrchestrationContextSchema = z
  .object({
    // Request information
    nip: z
      .string()
      .regex(/^\d{10}$/, 'Must be exactly 10 digits')
      .describe('Input NIP number'),

    correlationId: z.string().min(1).describe('Request tracking ID'),

    startTime: z.date().describe('Request start timestamp'),

    // GUS classification data (stored as raw GUS response with derived routing flags)
    classification: GusClassificationResponseSchema.extend({
      // Add derived routing flags for backwards compatibility
      silosId: z.string().optional(),
      requiresKrs: z.boolean().optional(),
      requiresCeidg: z.boolean().optional(),
      isDeregistered: z.boolean().optional(),
    })
      .optional()
      .describe('GUS classification result with routing flags'),

    // External API responses (raw data for processing)
    krsNumber: z
      .string()
      .regex(/^\d{10}$/, 'Must be exactly 10 digits')
      .optional()
      .describe('KRS number from GUS report'),

    krsData: KrsResponseSchema.optional().describe('Typed KRS API response'),

    ceidgData: CeidgCompanySchema.optional().describe('Typed CEIDG API response'),

    gusData: z
      .union([GusLegalPersonReportSchema, GusPhysicalPersonReportSchema])
      .optional()
      .describe('Typed GUS detailed report (legal or physical person)'),

    // Processing results
    finalCompanyData: UnifiedCompanyDataSchema.optional().describe(
      'Mapped final result',
    ),

    // Error tracking
    lastError: LastErrorSchema.optional().describe(
      'Most recent error information',
    ),

    // Retry tracking per service
    retryCount: RetryCountSchema.default(() => ({
      GUS: 0,
      KRS: 0,
      CEIDG: 0,
    })).describe('Per-service retry counters'),

    // State machine metadata
    currentState: z
      .string()
      .optional()
      .describe('Current state machine state for debugging'),

    timeoutAt: z.date().optional().describe('When the request should timeout'),

    // Performance tracking
    timings: z
      .record(z.string(), z.number())
      .default(() => ({}))
      .describe('Service response time tracking in milliseconds'),
  })
  .refine(
    (data) => {
      // Validate that if we have finalCompanyData, the NIP matches
      if (data.finalCompanyData) {
        return data.finalCompanyData.nip === data.nip;
      }
      return true;
    },
    {
      message: 'Final company data NIP must match context NIP',
      path: ['finalCompanyData', 'nip'],
    },
  )
  .refine(
    (data) => {
      // Validate that classification exists if we have KRS or CEIDG data
      if ((data.krsData || data.ceidgData) && !data.classification) {
        return false;
      }
      return true;
    },
    {
      message:
        'Classification must exist before external API data can be populated',
      path: ['classification'],
    },
  );

// TypeScript types
export type OrchestrationContext = z.infer<typeof OrchestrationContextSchema>;
export type CompanyClassification = z.infer<typeof CompanyClassificationSchema>;
export type LastError = z.infer<typeof LastErrorSchema>;

// Helper function to create initial context
export function createInitialContext(
  nip: string,
  correlationId: string,
): OrchestrationContext {
  return OrchestrationContextSchema.parse({
    nip,
    correlationId,
    startTime: new Date(),
    retryCount: { GUS: 0, KRS: 0, CEIDG: 0 },
    timings: {},
  });
}

// Helper function to create classification with auto-calculated flags
export function createCompanyClassification(
  silosId: string,
  regon: string,
  typ: string,
): CompanyClassification {
  // Schema automatically calculates routing flags via .transform()
  return CompanyClassificationSchema.parse({
    silosId,
    regon,
    typ,
  });
}

// Context update helpers
export const ContextUpdaters = {
  addClassification: (
    context: OrchestrationContext,
    classification: CompanyClassification,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      classification,
    });
  },

  addKrsData: (
    context: OrchestrationContext,
    krsData: z.infer<typeof KrsResponseSchema>,
    responseTimeMs?: number,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      krsData: krsData,
      timings: responseTimeMs
        ? { ...context.timings, KRS: responseTimeMs }
        : context.timings,
    });
  },

  addCeidgData: (
    context: OrchestrationContext,
    ceidgData: z.infer<typeof CeidgCompanySchema>,
    responseTimeMs?: number,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      ceidgData: ceidgData,
      timings: responseTimeMs
        ? { ...context.timings, CEIDG: responseTimeMs }
        : context.timings,
    });
  },

  addGusData: (
    context: OrchestrationContext,
    gusData:
      | z.infer<typeof GusLegalPersonReportSchema>
      | z.infer<typeof GusPhysicalPersonReportSchema>,
    responseTimeMs?: number,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      gusData: gusData,
      timings: responseTimeMs
        ? { ...context.timings, GUS: responseTimeMs }
        : context.timings,
    });
  },

  setFinalData: (
    context: OrchestrationContext,
    finalCompanyData: z.infer<typeof UnifiedCompanyDataSchema>,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      finalCompanyData,
    });
  },

  addError: (
    context: OrchestrationContext,
    error: Omit<LastError, 'timestamp'>,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      lastError: {
        ...error,
        timestamp: new Date().toISOString(),
      },
    });
  },

  incrementRetry: (
    context: OrchestrationContext,
    service: keyof typeof context.retryCount,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      retryCount: {
        ...context.retryCount,
        [service]: context.retryCount[service] + 1,
      },
    });
  },

  setState: (
    context: OrchestrationContext,
    currentState: string,
  ): OrchestrationContext => {
    return OrchestrationContextSchema.parse({
      ...context,
      currentState,
    });
  },

  setTimeout: (
    context: OrchestrationContext,
    timeoutMs: number,
  ): OrchestrationContext => {
    const timeoutAt = new Date(context.startTime.getTime() + timeoutMs);
    return OrchestrationContextSchema.parse({
      ...context,
      timeoutAt,
    });
  },
};

// Context query helpers
export const ContextQueries = {
  hasClassification: (context: OrchestrationContext): boolean => {
    return context.classification !== undefined;
  },

  requiresKrsData: (context: OrchestrationContext): boolean => {
    return context.classification?.requiresKrs === true;
  },

  requiresCeidgData: (context: OrchestrationContext): boolean => {
    return context.classification?.requiresCeidg === true;
  },

  isDeregistered: (context: OrchestrationContext): boolean => {
    return context.classification?.isDeregistered === true;
  },

  hasAllRequiredData: (context: OrchestrationContext): boolean => {
    if (!context.classification) return false;

    // Always need GUS data
    if (!context.gusData) return false;

    // Check service-specific requirements
    if (context.classification.requiresKrs && !context.krsData) return false;
    if (context.classification.requiresCeidg && !context.ceidgData)
      return false;

    return true;
  },

  canRetry: (
    context: OrchestrationContext,
    service: string,
    maxRetries: number,
  ): boolean => {
    return (context.retryCount[service] || 0) < maxRetries;
  },

  isTimedOut: (context: OrchestrationContext): boolean => {
    if (!context.timeoutAt) return false;
    return new Date() > context.timeoutAt;
  },

  getElapsedTimeMs: (context: OrchestrationContext): number => {
    return new Date().getTime() - context.startTime.getTime();
  },

  getAverageResponseTime: (context: OrchestrationContext): number => {
    const times = Object.values(context.timings).filter((t) => t > 0);
    if (times.length === 0) return 0;
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  },
};

// Validation helpers
export function validateOrchestrationContext(
  data: unknown,
): OrchestrationContext {
  return OrchestrationContextSchema.parse(data);
}

export function isValidOrchestrationContext(
  data: unknown,
): data is OrchestrationContext {
  return OrchestrationContextSchema.safeParse(data).success;
}

// Export sub-schemas for reuse
export { CompanyClassificationSchema, LastErrorSchema, RetryCountSchema };
