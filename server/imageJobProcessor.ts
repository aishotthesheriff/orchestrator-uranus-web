import { storage } from './storage';
import { generateImage, checkImageCache } from './aiService';
import { imageJobDuration, imageJobsCompleted, imageJobsFailed, queueDepthImage, imageCacheHits, imageCacheMisses } from './metrics';
import type { Server as SocketIOServer } from 'socket.io';
import type { ImageJob } from '@shared/schema';
import { convertImageUrlToStaticPath } from './imageUrl';

export class ImageJobProcessor {
  private io: SocketIOServer;
  private processing = false;
  private interval: NodeJS.Timeout | null = null;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  start(intervalMs = 1000) {
    if (this.interval) return;
    
    this.interval = setInterval(() => {
      this.processPendingJobs();
    }, intervalMs);
    
    console.log('Image job processor started');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async processPendingJobs() {
    if (this.processing) return;
    
    this.processing = true;
    try {
      const pendingJobs = await storage.claimPendingImageJobs(5);
      queueDepthImage.set(pendingJobs.length);
      
      if (pendingJobs.length > 0) {
        console.log(`[ImageJobProcessor] Processing ${pendingJobs.length} pending image job(s)`);
      }
      
      for (const job of pendingJobs) {
        console.log(`[ImageJobProcessor] Starting job ${job.id} for game ${job.gameId} turn ${job.turnNumber}`);
        await this.processJob(job);
      }
    } catch (error) {
      console.error('[ImageJobProcessor] Error processing image jobs:', error);
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: ImageJob) {
    const endTimer = imageJobDuration.startTimer();
    try {
      // Job status is already set to 'processing' by claimPendingImageJobs
      
      // Get game state
      const gameState = await storage.getGameState(job.gameId);
      if (!gameState) {
        await storage.updateImageJob(job.id, { status: 'failed', error: `Game ${job.gameId} not found`, completedAt: new Date() });
        imageJobsFailed.inc();
        return;
      }
      
      // Load user preferences from API at the start of image job processing
      const userPreferences = await storage.getUserPreferences(gameState.username);
      
      // Cache-first approach: check cache first, then fall back to generation
      let result: { imageUrl: string; promptUsed: string; templateName: string; promptSource: 'pce' | 'template' } | null = null;

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
        console.error(`[ImageJobProcessor] Image prompt missing from job: ${JSON.stringify(errorContext)}`);
        throw new Error(`PCE image generation failed: imagePrompt is required but missing from job. ${JSON.stringify(errorContext)}`);
      }

      // Check user preference - skip cache if skipImageCache is true (system default)
      const skipCache = userPreferences.skipImageCache ?? true;
      
      if (!skipCache) {
      // Try cache check first (includes both exact and similar matches)
      result = await checkImageCache(imagePrompt.trim(), gameState, userPreferences, {
        turnNumber: job.turnNumber
      });
      }
      
      if (result) {
        // Cache hit - convert data URL to static file path
        // checkImageCache returns data URLs, but we need the file path from database
        result.imageUrl = await convertImageUrlToStaticPath(
          { imageUrl: result.imageUrl, templateName: job.templateName },
          { gameState, userPreferences }
        );
        
        imageCacheHits.inc();
      } else {
        // Cache miss - generate new image
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
          console.error(`[ImageJobProcessor] Image prompt missing from job: ${JSON.stringify(errorContext)}`);
          throw new Error(`PCE image generation failed: imagePrompt is required but missing from job. ${JSON.stringify(errorContext)}`);
        }

        result = await generateImage(imagePrompt.trim(), gameState, userPreferences, {
          turnNumber: job.turnNumber
        });

        // generateImage returns data URL for new images - convert to static path
        if (result && result.imageUrl) {
          result.imageUrl = await convertImageUrlToStaticPath(
            { imageUrl: result.imageUrl, templateName: result.templateName },
            { gameState, userPreferences }
          );
        }
        
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
        
        // Update game state with image using a transaction to avoid overwriting newer data
        await storage.processTurnWithTransaction(job.gameId, async latestState => {
          const turnToUpdate = latestState.turns.find(t => t.turnNumber === job.turnNumber);
          
          if (!turnToUpdate) {
            console.warn(`Turn ${job.turnNumber} not found when applying image result for game ${job.gameId}`);
            return latestState;
          }
          
          turnToUpdate.imageUrl = result.imageUrl;
          turnToUpdate.imageTemplate = result.templateName;
          turnToUpdate.imagePromptSource = result.promptSource;
          const resultModelKey = (result as any).modelKey;
          if (typeof resultModelKey === 'string' && resultModelKey.trim().length > 0) {
            turnToUpdate.imageModelKey = resultModelKey.trim();
          }
          if ('imageStatus' in turnToUpdate) {
            // Mark image generation as complete if the field exists
            (turnToUpdate as any).imageStatus = 'completed';
          }
          if ('imageJobId' in turnToUpdate && turnToUpdate.imageJobId === job.id) {
            // Clear the job reference once the image is ready
            delete (turnToUpdate as any).imageJobId;
          }
          
          console.log(`[ImageJobProcessor] Set imageUrl for turn ${job.turnNumber}:`, {
            imageUrl: result.imageUrl,
            isDataUrl: result.imageUrl?.startsWith('data:'),
            isStaticPath: result.imageUrl?.startsWith('/generated_images/'),
            templateName: result.templateName
          });
          
          return latestState;
        });
        
        // Notify client via WebSocket
        const imageReadyPayload = {
          jobId: job.id,
          gameId: job.gameId,
          turnNumber: job.turnNumber,
          imageUrl: result.imageUrl,
          imageTemplate: result.templateName,
          promptSource: result.promptSource
        };
        
        console.log(`[ImageJobProcessor] Emitting imageReady WebSocket event:`, {
          gameId: job.gameId,
          turnNumber: job.turnNumber,
          jobId: job.id,
          imageUrl: result.imageUrl,
          imageTemplate: result.templateName,
          roomMembers: (this.io.sockets.adapter.rooms.get(job.gameId)?.size || 0)
        });
        
        this.io.to(job.gameId).emit('imageReady', imageReadyPayload);
        
        imageJobsCompleted.inc();
        console.log(`[ImageJobProcessor] Image generated and notified for game ${job.gameId} turn ${job.turnNumber}`);
      } else {
        throw new Error('Image generation returned no result');
      }
    } catch (error) {
      imageJobsFailed.inc();
      console.error('Error processing image job:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId: job.id,
        gameId: job.gameId,
        turnNumber: job.turnNumber,
        templateName: job.templateName,
        error: error
      });
      
      await storage.updateImageJob(job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      });
      
      // Update turn status to failed
      try {
        await storage.processTurnWithTransaction(job.gameId, async (state) => {
          const turnToUpdate = state.turns.find(t => t.turnNumber === job.turnNumber);
          if (turnToUpdate && 'imageStatus' in turnToUpdate) {
            // Type-safe assignment (imageStatus is defined in Turn interface)
            turnToUpdate.imageStatus = 'failed';
          }
          return state;
        });
      } catch (updateError) {
        const errorDetails = {
          jobId: job.id,
          gameId: job.gameId,
          turnNumber: job.turnNumber,
          error: updateError instanceof Error ? updateError.message : String(updateError),
          stack: updateError instanceof Error ? updateError.stack : undefined,
          warning: "Image job marked as failed but turn status update failed - data inconsistency possible"
        };
        console.error('Failed to update turn status to failed:', errorDetails);
        // Don't fail the whole job failure handling - job already marked as failed
      }
      
      // Notify client of failure
      const imageFailedPayload = {
        jobId: job.id,
        gameId: job.gameId,
        turnNumber: job.turnNumber,
        error: error instanceof Error ? error.message : String(error)
      };
      
      console.log(`[ImageJobProcessor] Emitting imageFailed WebSocket event:`, {
        gameId: job.gameId,
        turnNumber: job.turnNumber,
        jobId: job.id,
        error: imageFailedPayload.error,
        roomMembers: (this.io.sockets.adapter.rooms.get(job.gameId)?.size || 0)
      });
      
      this.io.to(job.gameId).emit('imageFailed', imageFailedPayload);
    } finally {
      endTimer();
    }
  }
}
