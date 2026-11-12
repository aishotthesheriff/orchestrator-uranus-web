import { randomUUID } from "crypto";
import type { GameState, InsertGameState, ActionChip } from "@shared/schema";
import { getSegment, getInitialNpcs } from "./gameEngine";
import { processIntroTurn, applyPrecomputedIntroTurn, prepareTurnImageMetadata } from "./gameLogic";
import { storage } from "./storage";
import { getSocketIO } from "./socketManager";
import { resolvePceSelections } from "./pce/settings.js";
import { generateTurnContentWithFlag, generateActions } from "./aiService";

export type CreativeSelectionInput = {
  theme?: string;
  style?: string;
};

export async function getCreativeSelections(
  overrides: CreativeSelectionInput = {}
) {
  return resolvePceSelections(overrides);
}

// getInitialNpcs is now imported from gameEngine

export async function buildInitialGameState(validated: InsertGameState): Promise<GameState> {
  const gameId = randomUUID();
  return {
    id: gameId,
    username: validated.username,
    seed: validated.seed || randomUUID(),
    day: 1,
    turnNumber: 0,
    segment: getSegment(1),
    absurdity: validated.absurdity ?? 2,
    stats: {
      hull: 100,
      oxygen: 100,
      fuel: 100,
      food: 100,
      morale: 100,
      weirdness: 0
    },
    npcs: await getInitialNpcs(),
    equippedItems: ['red_tape', 'universal_allen_key', 'nebula_freshener'],
    turns: [],
    currentActions: [],
    runningGags: [],
    eventHistory: [],
    interviewResponses: {},
    isComplete: false
  };
}

export async function initializeNewGame(validated: InsertGameState): Promise<GameState> {
  // Create initial game state object (empty turns and actions)
  const gameState = await buildInitialGameState(validated);

  // Save empty state to DB first
  await storage.createGameState(gameState);

  try {
    // Load user preferences for intro processing
    const userPreferences = await storage.getUserPreferences(gameState.username);
    
    console.log('[GAME_FLOW] Precomputing intro turn content (outside transaction)', {
      gameId: gameState.id,
      username: gameState.username,
      userPreferences
    });
    
    // PRECOMPUTE PHASE: Generate LLM content OUTSIDE transaction
    // This allows multiple concurrent requests to precompute in parallel
    // without holding database locks during slow LLM calls
    const turnContent = await generateTurnContentWithFlag(
      gameState,
      "Beginning the voyage to Uranus",
      [],
      userPreferences,
      { intro: true },
      null
    );
    
    console.log('[GAME_FLOW] Intro turn content precomputed', {
      gameId: gameState.id,
      hasNarration: !!turnContent.narration,
      narrationLength: turnContent.narration?.length || 0,
      hasImagePrompt: !!turnContent.imagePrompt,
      imagePromptLength: turnContent.imagePrompt?.length || 0,
      theme: turnContent.theme,
      style: turnContent.style,
      hasActions: !!turnContent.actions,
      actionsCount: turnContent.actions?.length || 0
    });
    
    // Use actions from PCE pipeline (always generated, no fallback needed)
    if (!turnContent.actions || !Array.isArray(turnContent.actions) || turnContent.actions.length === 0) {
      throw new Error(`PCE pipeline failed to generate actions for intro turn. Actions missing from turnContent.`);
    }
    
    const actions = turnContent.actions;
    console.log('[GAME_FLOW] Using actions from PCE pipeline', {
      gameId: gameState.id,
      actionsCount: actions.length
    });
    
    // PRECOMPUTE PHASE (continued): Check image cache OUTSIDE transaction
    // Create a temporary turn object for cache checking
    const tempIntroTurn: any = {
      turnNumber: 0,
      imagePrompt: turnContent.imagePrompt || undefined
    };
    
    const precomputedImageMetadata = await prepareTurnImageMetadata(
      gameState,
      tempIntroTurn,
      userPreferences,
      0
    );
    
    console.log('[GAME_FLOW] Image metadata precomputed', {
      gameId: gameState.id,
      hasCacheHit: !!precomputedImageMetadata,
      hasImageUrl: !!precomputedImageMetadata?.imageUrl
    });
    
    // APPLY PHASE: Apply precomputed content atomically INSIDE transaction
    // This ensures:
    // - Database lock held only during fast operations
    // - CAS check prevents duplicate intro turns (race condition protection)
    // - Atomic update of game state
    const updatedState = await applyPrecomputedIntroTurn(
      gameState.id,
      { turnContent, actions },
      userPreferences,
      precomputedImageMetadata
    );
    
    console.log('[GAME_FLOW] Intro turn applied atomically', {
      gameId: gameState.id,
      hasNarration: !!updatedState.turns[0]?.narrative,
      narrationLength: updatedState.turns[0]?.narrative?.length || 0,
      actionsCount: updatedState.currentActions.length
    });
    
    // Emit introReady event to the game room (best-effort)
    try {
      const io = getSocketIO();
      if (io) {
        io.to(gameState.id).emit('introReady', { gameId: gameState.id });
      }
    } catch (emitError) {
      console.warn('[GAME_FLOW] Failed to emit introReady event', {
        gameId: gameState.id,
        error: emitError instanceof Error ? emitError.message : String(emitError)
      });
    }

    return updatedState;
  } catch (error) {
    // Clean up orphaned game if intro creation fails
    try {
      await storage.deleteGameState(gameState.id);
      console.log('[GAME_FLOW] Cleaned up orphaned game after intro creation failure', {
        gameId: gameState.id,
        error: error instanceof Error ? error.message : String(error)
      });
    } catch (cleanupError) {
      const errorDetails = {
        gameId: gameState.id,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        cleanupErrorStack: cleanupError instanceof Error ? cleanupError.stack : undefined,
        originalError: error instanceof Error ? error.message : String(error),
        originalErrorStack: error instanceof Error ? error.stack : undefined,
        warning: "Game state may be orphaned in database - manual cleanup may be required"
      };
      console.error('[GAME_FLOW] Failed to cleanup orphaned game', errorDetails);
      // Don't throw cleanup error, preserve original error
    }
    
    // Re-throw original error to maintain existing error handling behavior
    throw error;
  }
}
