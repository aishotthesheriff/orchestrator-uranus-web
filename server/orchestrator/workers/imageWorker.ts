/**
 * Image Worker
 * Claims jobs from image queue, processes image generation/cache lookup,
 * and updates game state
 * Per SPEC_JOB_ORCHESTRATOR_AND_MANIFEST.md §4.4
 */

import { getOrchestrator } from '../index';
import { getQueueConfig } from '../../config/queues';
import { storage } from '../../storage';
import { generateImage, checkImageCache } from '../../aiService';
import { convertImageUrlToStaticPath } from '../../imageUrl';
import { imageJobDuration, imageJobsCompleted, imageJobsFailed, imageCacheHits, imageCacheMisses, imageProcessingDuration, e2eLatency } from '../../metrics';
import { log } from '../../logger';
import type { ImageJob } from '@shared/schema';
import type { JobLease } from '../types';
import { Server as SocketIOServer } from 'socket.io';

export class ImageWorker {
  private workerId: string;
  private io: SocketIOServer;
  private processing = false;
  private interval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private activeLeases: Map<string, { lease: JobLease<ImageJob>; heartbeatTimer: NodeJS.Timeout }> = new Map();

  constructor(io: SocketIOServer) {
    const hostname = process.env.HOSTNAME || 'unknown';
    const pid = process.pid;
    this.workerId = `image-${hostname}-${pid}`;
    this.io = io;
  }

  start(pollIntervalMs = 5000) {
    if (this.interval) return;

    const config = getQueueConfig('image');
    
    // Main polling loop
    this.interval = setInterval(() => {
      this.processPendingJobs().catch((error: unknown) => {
        log(`[ImageWorker] Error in processPendingJobs: ${String(error)}`);
      });
    }, config.pollFallbackMs || pollIntervalMs);

    // Heartbeat loop for active leases
    this.heartbeatInterval = setInterval(() => {
      this.heartbeatActiveLeases().catch((error: unknown) => {
        log(`[ImageWorker] Error in heartbeatActiveLeases: ${String(error)}`);
      });
    }, config.heartbeatIntervalMs);

    log(`[ImageWorker] Started with workerId: ${this.workerId}`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Release all active leases
    for (const [leaseId, { lease, heartbeatTimer }] of this.activeLeases.entries()) {
      clearTimeout(heartbeatTimer);
      lease.release().catch((error: unknown) => {
        log(`[ImageWorker] Error releasing lease ${leaseId}: ${String(error)}`);
      });
    }
    this.activeLeases.clear();
    
    log('[ImageWorker] Stopped');
  }

  private async processPendingJobs() {
    if (this.processing) return;
    this.processing = true;

    try {
      const orchestrator = getOrchestrator();
      const leases = await orchestrator.claim('image', this.workerId, { batchSize: 5 });

      for (const lease of leases) {
        // Track lease for heartbeat
        const config = getQueueConfig('image');
        const heartbeatTimer = setTimeout(() => {
          this.heartbeatLease(lease).catch((error: unknown) => {
            log(`[ImageWorker] Error heartbeating lease ${lease.leaseId}: ${String(error)}`);
          });
        }, config.heartbeatIntervalMs);
        
        this.activeLeases.set(lease.leaseId, { lease, heartbeatTimer });

        // Process job asynchronously (don't await)
        this.processJob(lease).finally(() => {
          this.activeLeases.delete(lease.leaseId);
          clearTimeout(heartbeatTimer);
      }).catch((error: unknown) => {
          log(`[ImageWorker] Error processing job ${lease.job.id}: ${String(error)}`);
        });
      }
    } catch (error) {
      log(`[ImageWorker] Error claiming jobs: ${String(error)}`);
    } finally {
      this.processing = false;
    }
  }

  private async heartbeatActiveLeases() {
    const now = Date.now();
    const config = getQueueConfig('image');

    for (const [leaseId, { lease }] of this.activeLeases.entries()) {
      const timeUntilExpiry = lease.leaseExpiresAt.getTime() - now;
      const extensionNeeded = config.leaseDurationMs * 0.5;

      if (timeUntilExpiry < extensionNeeded) {
        await this.heartbeatLease(lease);
      }
    }
  }

  private async heartbeatLease(lease: JobLease<ImageJob>) {
    const config = getQueueConfig('image');
    await lease.extend(config.leaseDurationMs);
  }

  private async processJob(lease: JobLease<ImageJob>) {
    const payload = lease.job.payload as { id: string };
    const endTimer = imageJobDuration.startTimer();
    const totalTimer = imageProcessingDuration.startTimer({ operation: 'total', cache: 'miss' });

    try {
      // Load full job from database (payload only contains id)
      const job = await storage.getImageJob(payload.id);
      if (!job) {
        await lease.fail({
          reason: 'permanent',
          message: `Image job ${payload.id} not found in database`,
        });
        imageJobsFailed.inc();
        totalTimer({ cache: 'miss' });
        return;
      }

      log(`[ImageWorker] Processing job ${job.id} for game ${job.gameId} turn ${job.turnNumber}`);

      // Track job creation time for end-to-end latency
      const jobCreatedAt = job.createdAt ? new Date(job.createdAt).getTime() : null;

      // Get game state
      const gameState = await storage.getGameState(job.gameId);
      if (!gameState) {
        await storage.updateImageJob(job.id, { status: 'failed', error: `Game ${job.gameId} not found`, completedAt: new Date() });
        imageJobsFailed.inc();
        await lease.fail({
          reason: 'permanent',
          message: `Game ${job.gameId} not found`,
        });
        totalTimer({ cache: 'miss' });
        return;
      }

      // Load user preferences
      const userPreferences = await storage.getUserPreferences(gameState.username);

      // Get imagePrompt from job (stored in templateName field for backward compatibility)
      const imagePrompt = job.templateName; // TODO: Migrate to imagePrompt field
      
      if (!imagePrompt || typeof imagePrompt !== 'string' || imagePrompt.trim().length === 0) {
        const errorContext = {
          jobId: job.id,
          gameId: job.gameId,
          turnNumber: job.turnNumber,
          hasTemplateName: !!job.templateName,
          templateNameType: typeof job.templateName
        };
        log(`[ImageWorker] Image prompt missing from job: ${JSON.stringify(errorContext)}`);
        throw new Error(`PCE image generation failed: imagePrompt is required but missing from job. ${JSON.stringify(errorContext)}`);
      }

      // Cache-first approach: check cache first, then fall back to generation
      let result: { imageUrl: string; promptUsed: string; templateName: string; promptSource: 'pce' | 'template' } | null = null;
      let cacheHit = false;

      // Check user preference - skip cache if skipImageCache is true (system default)
      const skipCache = userPreferences.skipImageCache ?? true;

      if (!skipCache) {
      // Try cache check first
      const cacheTimer = imageProcessingDuration.startTimer({ operation: 'cache_lookup', cache: 'miss' });
      result = await checkImageCache(imagePrompt.trim(), gameState, userPreferences, {
        turnNumber: job.turnNumber
      });
      cacheHit = !!result;
      cacheTimer({ cache: cacheHit ? 'hit' : 'miss' });
      }

      if (result) {
        // Cache hit - convert data URL to static file path
        const storageTimer = imageProcessingDuration.startTimer({ operation: 'storage', cache: 'hit' });
        result.imageUrl = await convertImageUrlToStaticPath(
          { imageUrl: result.imageUrl, templateName: imagePrompt.trim() },
          { gameState, userPreferences }
        );
        storageTimer();
        imageCacheHits.inc();
      } else {
        // Cache miss - generate new image
        const genTimer = imageProcessingDuration.startTimer({ operation: 'generation', cache: 'miss' });
        result = await generateImage(imagePrompt.trim(), gameState, userPreferences, {
          turnNumber: job.turnNumber
        });
        genTimer();

        // Convert data URL to static path
        const storageTimer = imageProcessingDuration.startTimer({ operation: 'storage', cache: 'miss' });
        if (result && result.imageUrl) {
          result.imageUrl = await convertImageUrlToStaticPath(
            { imageUrl: result.imageUrl, templateName: result.templateName },
            { gameState, userPreferences }
          );
        }
        storageTimer();

        imageCacheMisses.inc();
      }

      if (result) {
        // Update job status
        await storage.updateImageJob(job.id, {
          status: 'completed',
          imageUrl: result.imageUrl,
          imageTemplate: result.templateName,
          completedAt: new Date()
        });

        // Update game state with image using a transaction
        await storage.processTurnWithTransaction(job.gameId, async latestState => {
          const turnToUpdate = latestState.turns.find(t => t.turnNumber === job.turnNumber);

          if (!turnToUpdate) {
            log(`[ImageWorker] Turn ${job.turnNumber} not found when applying image result for game ${job.gameId}`);
            return latestState;
          }

          turnToUpdate.imageUrl = result!.imageUrl;
          turnToUpdate.imageTemplate = result!.templateName;
          turnToUpdate.imagePromptSource = result!.promptSource;
          
          const resultModelKey = (result as any).modelKey;
          if (typeof resultModelKey === 'string' && resultModelKey.trim().length > 0) {
            turnToUpdate.imageModelKey = resultModelKey.trim();
          }
          
          if ('imageStatus' in turnToUpdate) {
            (turnToUpdate as any).imageStatus = 'completed';
          }
          
          if ('imageJobId' in turnToUpdate && (turnToUpdate as any).imageJobId === job.id) {
            delete (turnToUpdate as any).imageJobId;
          }

          log(
            `[ImageWorker] Set imageUrl for turn ${job.turnNumber}: ${JSON.stringify({
              imageUrl: result!.imageUrl,
              isDataUrl: result!.imageUrl?.startsWith('data:'),
              isStaticPath: result!.imageUrl?.startsWith('/generated_images/'),
              templateName: result!.templateName
            })}`
          );

          return latestState;
        });

        // Notify client via WebSocket
        const imageReadyPayload = {
          jobId: job.id,
          gameId: job.gameId,
          turnNumber: job.turnNumber,
          imageUrl: result.imageUrl,
          templateName: result.templateName,
        };

        this.io.to(job.gameId).emit('imageReady', imageReadyPayload);

        // Complete lease
        await lease.complete({
          imageUrl: result.imageUrl,
          templateName: result.templateName,
        });

        imageJobsCompleted.inc();
        
        // Record end-to-end latency
        if (jobCreatedAt) {
          const e2eDuration = Date.now() - jobCreatedAt;
          e2eLatency.observe({ operation: 'image' }, e2eDuration);
        }

        totalTimer({ cache: cacheHit ? 'hit' : 'miss' });
        log(`[ImageWorker] Completed job ${job.id} for game ${job.gameId} turn ${job.turnNumber}`);
      } else {
        totalTimer({ cache: 'miss' });
        throw new Error('Failed to generate or retrieve image');
      }
    } catch (error) {
      totalTimer({ cache: 'miss' });
      const jobId = payload.id;
      log(`[ImageWorker] Failed to process job ${jobId}: ${String(error)}`);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Try to load job to get gameId/turnNumber for error reporting
      const job = await storage.getImageJob(jobId).catch(() => null);
      
      if (job) {
        await storage.updateImageJob(job.id, {
          status: 'failed',
          error: errorMessage,
          completedAt: new Date()
        });

        // Notify client of failure
        this.io.to(job.gameId).emit('imageFailed', {
          jobId: job.id,
          gameId: job.gameId,
          turnNumber: job.turnNumber,
          error: errorMessage,
        });
      } else {
        // Job not found, just log the error
        log(`[ImageWorker] Could not load job ${jobId} for error reporting`);
      }

      const isTransient = this.isTransientError(error);
      
      await lease.fail({
        reason: isTransient ? 'transient' : 'permanent',
        message: errorMessage,
        details: { stack: error instanceof Error ? error.stack : undefined },
      });

      imageJobsFailed.inc();
    } finally {
      endTimer();
    }
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('timeout') ||
             message.includes('network') ||
             message.includes('rate limit') ||
             message.includes('econnreset') ||
             message.includes('enotfound');
    }
    return false;
  }
}
