import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bottleneck from 'bottleneck';
import type { Environment } from '../../../config/environment.schema';

/**
 * GUS API Rate Limiter Service
 *
 * Implements global rate limiting for all outgoing requests to GUS API using
 * Bottleneck library with token bucket algorithm.
 *
 * Why Bottleneck?
 * - Token bucket algorithm: Allows burst traffic while maintaining average rate
 * - Global singleton: All GUS operations share the same rate limit quota
 * - Thread-safe: Handles concurrent requests automatically via internal queue
 * - Zero dependencies: Lightweight, no additional packages required
 * - Promise-based: Clean async/await integration
 *
 * Problem Solved:
 * Previously, GUS service used naive `setTimeout(100ms)` which didn't prevent
 * concurrent requests from hitting the API simultaneously. This service ensures
 * that all requests (from all concurrent operations) are properly queued and
 * executed at a controlled rate.
 *
 * Configuration:
 * - `GUS_MAX_REQUESTS_PER_SECOND`: Maximum requests per second (default: 10)
 * - Token bucket: Reservoir refills every second with configured tokens
 * - Max concurrent: 1 (serialize all requests to avoid race conditions)
 *
 * Usage:
 * ```typescript
 * // Wrap any async operation that calls GUS API
 * await this.rateLimiter.schedule(() => this.performGusApiCall());
 * ```
 *
 * Architecture:
 * - Injectable NestJS service (global singleton)
 * - Configured via environment variables
 * - Cleanup on module destroy (graceful shutdown)
 * - Structured logging for monitoring rate limit behavior
 */
@Injectable()
export class GusRateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(GusRateLimiterService.name);
  private readonly limiter: Bottleneck;
  private readonly maxRequestsPerSecond: number;

  constructor(private readonly configService: ConfigService<Environment, true>) {
    this.maxRequestsPerSecond = this.configService.get('GUS_MAX_REQUESTS_PER_SECOND', { infer: true });

    // Initialize Bottleneck with token bucket configuration
    this.limiter = new Bottleneck({
      // Token bucket configuration
      reservoir: this.maxRequestsPerSecond, // Initial number of tokens
      reservoirRefreshAmount: this.maxRequestsPerSecond, // Tokens to add on refresh
      reservoirRefreshInterval: 1000, // Refresh every 1 second (1000ms)

      // Concurrency control
      maxConcurrent: 1, // Execute one request at a time (serialize operations)

      // No minimum delay between requests (handled by reservoir)
      minTime: 0,
    });

    this.logger.log('GUS Rate Limiter initialized', {
      maxRequestsPerSecond: this.maxRequestsPerSecond,
      algorithm: 'token-bucket',
      reservoirSize: this.maxRequestsPerSecond,
      reservoirRefreshInterval: '1000ms',
    });

    // Log rate limiter events for monitoring
    this.limiter.on('failed', (error, jobInfo) => {
      this.logger.error('Rate limiter job failed', {
        error: error instanceof Error ? error.message : String(error),
        retryCount: jobInfo.retryCount,
      });
    });

    this.limiter.on('retry', (error, jobInfo) => {
      this.logger.warn('Rate limiter retrying job', {
        error: error instanceof Error ? error.message : String(error),
        retryCount: jobInfo.retryCount,
      });
    });

    this.limiter.on('depleted', () => {
      this.logger.debug('Rate limiter reservoir depleted, queuing requests');
    });
  }

  /**
   * Schedule an operation to run with rate limiting
   *
   * This method wraps the provided async function with Bottleneck's scheduler,
   * ensuring that the operation respects the configured rate limit.
   *
   * The scheduler uses a token bucket algorithm:
   * 1. Each operation consumes one token from the reservoir
   * 2. If reservoir is empty, operation is queued
   * 3. Reservoir refills with configured tokens every second
   * 4. Queued operations execute when tokens become available
   *
   * @param fn - Async function to execute with rate limiting
   * @returns Promise that resolves with the function's return value
   *
   * @example
   * ```typescript
   * // Schedule a GUS API call
   * const result = await this.rateLimiter.schedule(async () => {
   *   return await this.callGusApi();
   * });
   * ```
   */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    this.logger.debug('Scheduling operation with rate limiter', {
      queuedJobs: this.limiter.counts().QUEUED,
      runningJobs: this.limiter.counts().RUNNING,
    });

    return this.limiter.schedule(fn);
  }

  /**
   * Get current rate limiter statistics
   *
   * Useful for monitoring and debugging rate limit behavior.
   *
   * @returns Bottleneck counts object with queue statistics
   */
  getCounts() {
    return this.limiter.counts();
  }

  /**
   * Cleanup on module destroy
   *
   * Ensures graceful shutdown by waiting for all queued jobs to complete
   * before destroying the rate limiter.
   */
  async onModuleDestroy() {
    this.logger.log('Shutting down GUS Rate Limiter');
    await this.limiter.stop({ dropWaitingJobs: false });
    this.logger.log('GUS Rate Limiter stopped gracefully');
  }
}
