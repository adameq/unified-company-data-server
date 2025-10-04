import { Injectable, Logger } from '@nestjs/common';
import { parseStringPromise } from 'xml2js';
import { stripPrefix } from 'xml2js/lib/processors';
import { BusinessException } from '@common/exceptions/business-exceptions';

/**
 * GUS Response Parser
 *
 * Single Responsibility: Parse and extract XML data from GUS SOAP responses
 *
 * Responsibilities:
 * - Extract XML data from SOAP result envelopes (case-insensitive key matching)
 * - Parse XML strings to JavaScript objects (xml2js)
 * - Detect GUS API errors in parsed data (ErrorCode field)
 *
 * NOT responsible for:
 * - Zod validation (handled by GusResponseValidator)
 * - Error conversion to ErrorResponse (handled by GusErrorHandler)
 * - SOAP operation execution (handled by GusService)
 */

/**
 * GUS error detected in parsed XML response
 */
export interface GusApiError {
  errorCode: string;
  errorMessage: string;
}

@Injectable()
export class GusResponseParser {
  private readonly logger = new Logger(GusResponseParser.name);

  /**
   * Extract SOAP result from response envelope
   *
   * Handles strong-soap's inconsistent XML parsing:
   * - Sometimes returns PascalCase keys (DaneSzukajPodmiotyResult)
   * - Sometimes returns lowercase keys (daneszukajpodmiotyresult)
   *
   * Uses case-insensitive key matching to handle both variants.
   *
   * @param result - SOAP response object from strong-soap
   * @param operation - Operation name (e.g., 'DaneSzukajPodmioty')
   * @returns XML data string or throws if not found
   */
  extractSoapResult(result: any, operation: string): string {
    if (!result || typeof result !== 'object') {
      throw new Error(`Invalid SOAP result: expected object, got ${typeof result}`);
    }

    // Case-insensitive key search
    const resultKey = `${operation}Result`;
    const keys = Object.keys(result);
    const matchingKey = keys.find(
      (key) => key.toLowerCase() === resultKey.toLowerCase(),
    );

    if (!matchingKey) {
      this.logger.error(`SOAP result key not found`, {
        operation,
        expectedKey: resultKey,
        availableKeys: keys,
      });
      throw new Error(
        `SOAP result key not found: expected ${resultKey} (case-insensitive)`,
      );
    }

    const xmlData = result[matchingKey];

    if (typeof xmlData !== 'string') {
      throw new Error(
        `Invalid SOAP result data: expected string, got ${typeof xmlData}`,
      );
    }

    return xmlData;
  }

  /**
   * Parse XML response to JavaScript object
   *
   * Extracts data from GUS-specific XML structure: root.dane[0] or root.dane
   *
   * @param xmlString - XML string from GUS API
   * @param correlationId - Request correlation ID for logging
   * @returns Parsed JavaScript object
   * @throws Error if XML parsing fails or structure is invalid
   */
  async parseXmlResponse(
    xmlString: string,
    correlationId?: string,
  ): Promise<any> {
    try {
      const parsed = await parseStringPromise(xmlString, {
        explicitArray: false,
        tagNameProcessors: [stripPrefix],
        attrNameProcessors: [stripPrefix],
        normalize: true,
        trim: true,
      });

      // Extract data from root.dane structure (GUS specific format)
      const data = parsed?.root?.dane;
      if (!data) {
        throw new BusinessException({
          errorCode: 'GUS_SERVICE_UNAVAILABLE',
          message: 'GUS API error: Invalid XML structure - missing root.dane',
          correlationId: correlationId || `gus-${Date.now()}`,
          source: 'GUS',
        });
      }

      // If dane is an array, take the first element; otherwise use it directly
      return Array.isArray(data) ? data[0] : data;
    } catch (error) {
      this.logger.error('Failed to parse GUS XML response', {
        error: error instanceof Error ? error.message : String(error),
        xmlLength: xmlString.length,
        xmlSnippet: xmlString.substring(0, 200),
        correlationId,
      });

      // Re-throw BusinessException as-is
      if (error instanceof BusinessException) {
        throw error;
      }

      throw new Error(
        `Failed to parse GUS XML response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Detect GUS API error in parsed data
   *
   * Checks for ErrorCode field in parsed object (not raw XML string).
   * GUS API returns errors in this format:
   * ```xml
   * <root>
   *   <dane>
   *     <ErrorCode>4</ErrorCode>
   *     <ErrorMessagePl>Nie znaleziono podmiotu</ErrorMessagePl>
   *   </dane>
   * </root>
   * ```
   *
   * @param parsedData - Parsed JavaScript object from parseXmlResponse()
   * @returns GusApiError if error detected, null otherwise
   */
  detectGusError(parsedData: any): GusApiError | null {
    // Check for ErrorCode in parsed object (both nested and top-level)
    const errorCode = parsedData?.dane?.ErrorCode || parsedData?.ErrorCode;

    if (!errorCode) {
      return null;
    }

    const errorMessage =
      parsedData?.dane?.ErrorMessagePl ||
      parsedData?.ErrorMessagePl ||
      'Unknown GUS error';

    return {
      errorCode: String(errorCode),
      errorMessage: String(errorMessage),
    };
  }

  /**
   * Check if XML data is empty (common GUS pattern for "not found")
   *
   * @param xmlData - XML string to check
   * @returns true if empty, false otherwise
   */
  isEmptyXmlData(xmlData: string | null | undefined): boolean {
    if (!xmlData) return true;

    const trimmed = xmlData.trim();
    return trimmed === '' || trimmed === '<root></root>';
  }
}
