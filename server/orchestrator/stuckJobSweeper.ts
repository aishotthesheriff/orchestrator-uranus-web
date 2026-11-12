/**
 * Stuck Job Sweeper Service
 * Runs periodically to identify and re-queue jobs with expired leases
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.12
 */

import { getOrchestrator } from './index';
import { getQueueConfig } from '../config/queues';
import { log } from '../logger';
import { queueLeaseTimeoutTotal } from '../metrics';
import type { QueueName } from './types';

export class StuckJobSweeper {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the sweeper, running every 60 seconds
   */
  start(): void {
    if (this.intervalId) {
      log('[StuckJobSweeper] Already running');
      return;
    }

    log('[StuckJobSweeper] Starting stuck job sweeper (runs every 60s)');
    
    this.intervalId = setInterval(() => {
      this.sweep().catch((error) => {
        log(`[StuckJobSweeper] Error during sweep: ${error}`);
      });
    }, 60 * 1000); // 60 seconds

    // Run immediately on start
    this.sweep().catch((error) => {
      log(`[StuckJobSweeper] Error during initial sweep: ${error}`);
    });
  }

  /**
   * Stop the sweeper
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log('[StuckJobSweeper] Stopped');
    }
  }

  /**
   * Sweep all queues for stuck jobs
   */
  private async sweep(): Promise<void> {
    if (this.isRunning) {
      return; // Skip if previous sweep still running
    }

    this.isRunning = true;
    const now = new Date();
    const queues: QueueName[] = ['turn-precompute', 'turn-apply', 'image'];
    let totalStuck = 0;

    try {
      const orchestrator = getOrchestrator();

      for (const queue of queues) {
        try {
          const stuckJobIds = await orchestrator.markStuck({
            queue,
            olderThan: now,
          });

          if (stuckJobIds.length > 0) {
            totalStuck += stuckJobIds.length;
            queueLeaseTimeoutTotal.inc({ queue }, stuckJobIds.length);
            log(
              `[StuckJobSweeper] Found ${stuckJobIds.length} stuck jobs in ${queue}: ${JSON.stringify({ count: stuckJobIds.length, jobIds: stuckJobIds })}`
            );
          }
        } catch (error) {
          log(`[StuckJobSweeper] Error sweeping queue ${queue}: ${error}`);
        }
      }

      if (totalStuck > 0) {
        log(`[StuckJobSweeper] Sweep complete: ${totalStuck} stuck jobs re-queued`);
      }
    } catch (error) {
      log(`[StuckJobSweeper] Error during sweep: ${error}`);
    } finally {
      this.isRunning = false;
    }
  }
}
