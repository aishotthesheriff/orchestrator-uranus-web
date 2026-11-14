import type { GameState, ActionInput, Intent, ActionChip, EventDefinition, Check } from "@shared/schema";
import { NPC_SKILL_MAPPINGS } from "@shared/schema";
import { 
  SeededRandom, 
  getSegment, 
  calculateDC, 
  clampStat, 
  checkFailState, 
  checkWinCondition,
  getTriggeredEvents,
  applyDelta,
  calculateDailyConsumption,
  getItemById
} from "./gameEngine";
import { 
  generateTurnContentWithFlag, 
  generateActions, 
  mapCustomActionToIntent,
  checkImageCache,
  type TurnContentResult
} from "./aiService";
import { storage } from "./storage";
import { getJobService } from "./orchestrator/jobService";
import { convertImageUrlToStaticPath } from "./imageUrl";
import type { DbClient } from "./db";

export const INTRO_TURN_ACTION_ID = "__intro_turn__";

export function buildIntroActionInput(gameId: string): ActionInput {
  return {
    gameId,
    action: INTRO_TURN_ACTION_ID
  };
}

function mapIntentToSkill(intent: Intent): any {
  const mapping = {
    repair: 'Engineering',
    negotiate: 'Diplomacy',
    cook: 'Culinary',
    explore: 'Piloting',
    improvise: 'Vibes',
    research: 'Bureaucracy',
    command: 'Deception',
    other: 'Vibes'
  };
  return mapping[intent] || 'Vibes';
}

function getBaseDC(risk: string): number {
  switch (risk) {
    case 'Safe': return 10;
    case 'Risky': return 14;
    case 'Wild': return 18;
    default: return 12;
  }
}

function getActionConsequences(action: any, success: boolean): string {
  const risk = action.risk;

  if (success) {
    switch (risk) {
      case 'Safe': return 'hull+2,morale+1';
      case 'Risky': return 'hull+3,morale+2';
      case 'Wild': return 'hull+5,morale+3,weirdness+1';
      default: return 'morale+1';
    }
  } else {
    switch (risk) {
      case 'Safe': return 'hull-1';
      case 'Risky': return 'hull-2,morale-1';
      case 'Wild': return 'hull-3,morale-2,weirdness+1';
      default: return 'morale-1';
    }
  }
}

function getActionTags(intent: Intent): string[] {
  const tags = {
    repair: ['technical'],
    negotiate: ['crew', 'authority'],
    cook: ['crew', 'gross'],
    explore: ['travel'],
    improvise: ['absurd'],
    research: ['bureaucracy'],
    command: ['authority'],
    other: ['absurd']
  };
  return tags[intent] || ['absurd'];
}

function updateNPCAffinities(state: GameState, skill: any, success: boolean) {
  for (const npc of state.npcs) {
    const npcSkills = NPC_SKILL_MAPPINGS[npc.name];
    if (npcSkills && npcSkills.includes(skill)) {
      if (success) {
        npc.affinity = Math.min(npc.affinity + 1, 3);
        if (npc.affinity >= 2) {
          npc.status = 'Warm';
        } else if (npc.affinity >= 1) {
          npc.status = 'Friendly';
        }
      } else {
        npc.affinity = Math.max(npc.affinity - 1, -3);
        if (npc.affinity <= -2) {
          npc.status = 'Hostile';
        } else if (npc.affinity <= -1) {
          npc.status = 'Cold';
        } else {
          npc.status = 'Indifferent';
        }
      }
    }
  }
}

// getItemById is now imported from gameEngine

/**
 * Check image cache and prepare image metadata (called OUTSIDE transaction).
 * This performs I/O operations (database queries, file reads) that don't need transaction protection.
 * 
 * @param state - Current game state
 * @param turn - Turn object (for accessing imagePrompt)
 * @param userPreferences - User preferences for image processing
 * @param turnNumber - Turn number for image processing
 * @returns Prepared image metadata or null if cache miss
 */
export async function prepareTurnImageMetadata(
  state: GameState,
  turn: any,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  turnNumber: number
): Promise<{ imageUrl: string; templateName: string; promptSource: 'pce' | 'template'; modelKey?: string } | null> {
  try {
    // Require imagePrompt from PCE
    if (!turn.imagePrompt || typeof turn.imagePrompt !== 'string' || turn.imagePrompt.trim().length === 0) {
      const errorContext = {
        gameId: state.id,
        turnNumber,
        hasImagePrompt: !!turn.imagePrompt,
        imagePromptType: typeof turn.imagePrompt
      };
      console.error("[PCE] Image prompt missing from turn in prepareTurnImageMetadata", errorContext);
      throw new Error(`PCE image generation failed: imagePrompt is required but missing from turn. ${JSON.stringify(errorContext)}`);
    }
    
    const imagePrompt = turn.imagePrompt.trim();
    console.log('[GAME_FLOW] Checking image cache (outside transaction)', {
      imagePrompt: imagePrompt.substring(0, 100),
      turnNumber,
      gameId: state.id
    });
    
    // Check user preference - skip cache if skipImageCache is true (system default)
    const skipCache = userPreferences.skipImageCache ?? true;
    
    let imageResult = null;
    if (!skipCache) {
    // Use imagePrompt for cache checking - pass it as templateName for backward compatibility
      imageResult = await checkImageCache(imagePrompt, state, userPreferences, {
      turnNumber
    });
    }
    
    console.log('[GAME_FLOW] Image cache result', {
      found: !!imageResult,
      hasImageUrl: !!imageResult?.imageUrl,
      promptSource: imageResult?.promptSource,
      turnNumber
    });

    if (imageResult) {
      // checkImageCache returns data URLs - convert to static path if needed
      // This does database reads but is safe outside transaction
      const imageUrl = await convertImageUrlToStaticPath(
        { imageUrl: imageResult.imageUrl, templateName: imageResult.templateName },
        { gameState: state, userPreferences }
      );
      
      return {
        imageUrl,
        templateName: imageResult.templateName,
        promptSource: imageResult.promptSource,
        modelKey: (imageResult as any).modelKey
      };
    }
    
    return null;
  } catch (imageError) {
    const errorContext = {
      gameId: state.id,
      turnNumber,
      hasImagePrompt: !!turn.imagePrompt,
      error: imageError instanceof Error ? imageError.message : String(imageError),
      stack: imageError instanceof Error ? imageError.stack : undefined
    };
    console.error('Failed to prepare image metadata:', errorContext);
    // Return null on error - will create image job instead
    return null;
  }
}

/**
 * Process image for a turn (apply precomputed metadata or create job).
 * This is the FIRST-CLASS function for image processing used by ALL turns, including Turn 0 (Intro Turn).
 * 
 * Standard pattern (recommended):
 *   1. Call prepareTurnImageMetadata() OUTSIDE transaction
 *   2. Call processTurnImage() with precomputed metadata INSIDE transaction (for atomicity)
 * 
 * If called without precomputedMetadata, will do cache check inline (less efficient but backward compatible).
 * 
 * @param state - Current game state
 * @param turn - Turn object to attach image metadata to
 * @param userPreferences - User preferences for image processing
 * @param turnNumber - Turn number for image processing
 * @param precomputedMetadata - Pre-computed image metadata from prepareTurnImageMetadata() (recommended)
 *                              If not provided, will do cache check inline (backward compatibility mode)
 */
export async function processTurnImage(
  state: GameState,
  turn: any,
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  turnNumber: number,
  precomputedMetadata?: { imageUrl: string; templateName: string; promptSource: 'pce' | 'template'; modelKey?: string } | null,
  client?: DbClient,
): Promise<void> {
  let creatingJob = false;
  try {
    // Require imagePrompt from PCE
    if (!turn.imagePrompt || typeof turn.imagePrompt !== 'string' || turn.imagePrompt.trim().length === 0) {
      const errorContext = {
        gameId: state.id,
        turnNumber,
        hasImagePrompt: !!turn.imagePrompt,
        imagePromptType: typeof turn.imagePrompt
      };
      console.error("[PCE] Image prompt missing from turn in processTurnImage", errorContext);
      throw new Error(`PCE image generation failed: imagePrompt is required but missing from turn. ${JSON.stringify(errorContext)}`);
    }
    
    const imagePrompt = turn.imagePrompt.trim();
    
    // If metadata not precomputed, do cache check inline (backward compatibility)
    // This is less efficient but maintains compatibility with code that calls this directly
    let imageMetadata = precomputedMetadata;
    if (imageMetadata === undefined) {
      console.log('[GAME_FLOW] processTurnImage: No precomputed metadata, doing inline cache check (inefficient)', {
        imagePrompt: imagePrompt.substring(0, 100),
        turnNumber,
        gameId: state.id
      });
      imageMetadata = await prepareTurnImageMetadata(state, turn, userPreferences, turnNumber);
    }

    if (imageMetadata) {
      // Cache hit: Apply metadata to turn (fast, no I/O)
      turn.imageUrl = imageMetadata.imageUrl;
      turn.imageTemplate = imageMetadata.templateName; // Store for backward compatibility
      turn.imageStatus = 'completed';
      turn.imagePromptSource = 'pce'; // Always PCE now
      if (imageMetadata.modelKey && typeof imageMetadata.modelKey === 'string' && imageMetadata.modelKey.trim().length > 0) {
        turn.imageModelKey = imageMetadata.modelKey.trim();
      }
      
      console.log('[GAME_FLOW] Applied cached image metadata', {
        hasImageUrl: !!turn.imageUrl,
        turnNumber
      });
    } else {
      // Cache miss: Create image job atomically (INSIDE transaction)
      console.log('[GAME_FLOW] Creating image job (cache miss)', {
        gameId: state.id,
        turnNumber,
        imagePrompt: imagePrompt.substring(0, 100)
      });
      
      // Store imagePrompt in templateName field for backward compatibility with database
      // TODO: Migrate database schema to add imagePrompt field to ImageJobs
      creatingJob = true;
      const imageJob = await getJobService().createImageJob({
        gameId: state.id,
        turnNumber,
        templateName: imagePrompt, // Store imagePrompt in templateName field temporarily
        status: 'pending'
      }, { client });

      console.log('[GAME_FLOW] Image job created successfully', {
        jobId: imageJob.id,
        gameId: state.id,
        turnNumber,
        status: imageJob.status
      });

      turn.imageJobId = imageJob.id;
      turn.imageStatus = 'pending';
      turn.imagePromptSource = 'pce'; // Always PCE now
    }
  } catch (imageError) {
    const errorContext = {
      gameId: state.id,
      turnNumber,
      hasImagePrompt: !!turn.imagePrompt,
      error: imageError instanceof Error ? imageError.message : String(imageError),
      stack: imageError instanceof Error ? imageError.stack : undefined
    };
    console.error('Failed to process scene image:', errorContext);
    if (creatingJob) throw imageError;
    // Don't throw - allow turn to complete without image
  }
}

export async function processIntroTurn(
  state: GameState,
  userPreferences?: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  client?: DbClient,
): Promise<GameState> {
  // Load user preferences if not provided (standardized pattern)
  const prefs = userPreferences ?? await storage.getUserPreferences(state.username);
  
  console.log('[GAME_FLOW] processIntroTurn', {
    turnNumber: state.turnNumber,
    existingIntroTurn: state.turns.some(turn => turn.turnNumber === 0),
    userPreferences: prefs
  });

  if (state.turns.some(turn => turn.turnNumber === 0)) {
    console.warn("Intro turn already exists for this game state; skipping regeneration.");
    if (!Array.isArray(state.currentActions) || state.currentActions.length === 0) {
      // Actions should always be present if intro turn exists - this is an inconsistent state
      throw new Error("Intro turn exists but actions are missing. Game state is inconsistent.");
    }
    return state;
  }

  console.log('[GAME_FLOW] Calling generateTurnContentWithFlag for intro turn');
  const turnContent = await generateTurnContentWithFlag(
    state,
    "Beginning the voyage to Uranus",
    [],
    prefs,
    { intro: true },
    null
  );

  console.log('[GAME_FLOW] Intro turn content generated', {
    hasNarration: !!turnContent.narration,
    narrationLength: turnContent.narration?.length || 0,
    hasImagePrompt: !!turnContent.imagePrompt,
    imagePromptLength: turnContent.imagePrompt?.length || 0,
    theme: turnContent.theme,
    style: turnContent.style
  });

  const turn: any = {
    turnNumber: 0,
    action: INTRO_TURN_ACTION_ID,
    narrative: turnContent.narration,
    checks: [],
    delta: [],
    timestamp: Date.now(),
    imagePrompt: turnContent.imagePrompt || undefined,
    imageStyle: turnContent.style,
    imageMetadata: turnContent.imageMetadata ?? null,
    imageModelKey: turnContent.imageModelKey,
    promptChain: turnContent.promptChain ?? [],
    masterEnrichment: turnContent.masterEnrichment ?? null,
    toneHints: turnContent.toneHints ?? undefined,
    theme: turnContent.theme,
    style: turnContent.style,
    fallbackUsed: turnContent.fallbackUsed ?? false,
    imagePromptSource: turnContent.imagePromptSource
  };

  console.log('[GAME_FLOW] Turn object created', {
    hasImagePrompt: !!turn.imagePrompt,
    imagePromptLength: turn.imagePrompt?.length || 0,
    imageStyle: turn.imageStyle
  });

  // PRECOMPUTE PHASE: Check image cache OUTSIDE any transaction (no I/O holding locks)
  // This ensures processTurnImage is used consistently for all turns, including intro
  const precomputedImageMetadata = await prepareTurnImageMetadata(
    state,
    turn,
    prefs,
    state.turnNumber
  );
  
  console.log('[GAME_FLOW] Image metadata prepared for intro turn', {
    hasCacheHit: !!precomputedImageMetadata,
    hasImageUrl: !!precomputedImageMetadata?.imageUrl
  });

  // Process image using shared helper (standard for all turns)
  // Pass precomputed metadata to avoid I/O inside processTurnImage
  await processTurnImage(state, turn, prefs, state.turnNumber, precomputedImageMetadata, client);

  state.turns.push(turn);
  
  // Use actions from PCE pipeline (always generated, no fallback needed)
  if (!turnContent.actions || !Array.isArray(turnContent.actions) || turnContent.actions.length === 0) {
    throw new Error(`PCE pipeline failed to generate actions for intro turn. Actions missing from turnContent.`);
  }
  
  state.currentActions = turnContent.actions;
  console.log('[GAME_FLOW] Using actions from PCE pipeline', {
    actionsCount: turnContent.actions.length
  });

  return state;
}

/**
 * Apply precomputed intro turn content via a short CAS-style transaction.
 * This function moves LLM calls and image cache checks outside the transaction boundary for better concurrency.
 * 
 * @param gameId - The game ID
 * @param precomputed - Precomputed turn content and actions (generated outside transaction)
 * @param userPreferences - User preferences for image processing
 * @param precomputedImageMetadata - Precomputed image metadata from cache check (done outside transaction)
 * @returns Updated game state
 */
export async function applyPrecomputedIntroTurn(
  gameId: string,
  precomputed: {
    turnContent: TurnContentResult;
    actions: ActionChip[];
  },
  userPreferences: { theme?: string; style?: string; imageModelKey?: string; llmModelKey?: string; skipImageCache?: boolean },
  precomputedImageMetadata?: { imageUrl: string; templateName: string; promptSource: 'pce' | 'template'; modelKey?: string } | null
): Promise<GameState> {
  return await storage.processTurnWithTransaction(gameId, async (state, client) => {
    console.log('[GAME_FLOW] applyPrecomputedIntroTurn', {
      gameId,
      turnNumber: state.turnNumber,
      existingIntroTurn: state.turns.some(turn => turn.turnNumber === 0),
      hasPrecomputedTurn: !!precomputed.turnContent,
      hasPrecomputedActions: !!precomputed.actions
    });

    // CAS-style check: if intro turn already exists (defensive check for concurrent requests)
    if (state.turns.some(turn => turn.turnNumber === 0)) {
      console.warn("Intro turn already exists for this game state; skipping application.");
      // Only fill missing currentActions if empty
      if (!Array.isArray(state.currentActions) || state.currentActions.length === 0) {
        state.currentActions = precomputed.actions;
      }
      return state;
    }

    // Create turn object from precomputed content
    const turn: any = {
      turnNumber: 0,
      action: INTRO_TURN_ACTION_ID,
      narrative: precomputed.turnContent.narration,
      checks: [],
      delta: [],
      timestamp: Date.now(),
      imagePrompt: precomputed.turnContent.imagePrompt || undefined,
      imageStyle: precomputed.turnContent.style,
      imageMetadata: precomputed.turnContent.imageMetadata ?? null,
      imageModelKey: precomputed.turnContent.imageModelKey,
      promptChain: precomputed.turnContent.promptChain ?? [],
      masterEnrichment: precomputed.turnContent.masterEnrichment ?? null,
      toneHints: precomputed.turnContent.toneHints ?? undefined,
      theme: precomputed.turnContent.theme,
      style: precomputed.turnContent.style,
      fallbackUsed: precomputed.turnContent.fallbackUsed ?? false,
      imagePromptSource: precomputed.turnContent.imagePromptSource
    };

    console.log('[GAME_FLOW] Applying precomputed intro turn', {
      hasNarration: !!turn.narrative,
      narrationLength: turn.narrative?.length || 0,
      hasImagePrompt: !!turn.imagePrompt,
      imagePromptLength: turn.imagePrompt?.length || 0,
      imageStyle: turn.imageStyle,
      hasPrecomputedImageMetadata: precomputedImageMetadata !== undefined
    });

    // Process image using shared helper (inside transaction for atomicity)
    // Pass precomputed metadata to avoid I/O inside transaction
    await processTurnImage(state, turn, userPreferences, state.turnNumber, precomputedImageMetadata, client);

    // Apply precomputed turn and actions
    state.turns.push(turn);
    state.currentActions = precomputed.actions;

    return state;
  });
}

export async function prepareInitialGameState(state: GameState): Promise<GameState> {
  // Load user preferences from API at the start of turn 0
  const userPreferences = await storage.getUserPreferences(state.username);
  return processIntroTurn(state, userPreferences);
}

/**
 * Compute turn checks and game logic without modifying state (used for precomputation).
 * This allows computing what will happen before generating LLM content.
 * 
 * @param state - Current game state (read-only)
 * @param action - Player action
 * @returns Computed checks, selected action, event, and game state changes
 */
export async function computeTurnChecks(
  state: GameState,
  action: ActionInput
): Promise<{
  selectedAction: any;
  event: EventDefinition | null;
  skill: string;
  dc: number;
  checks: Check[];
  success: boolean;
  nextTurnNumber: number;
}> {
  // Find the selected action or create custom one
  let selectedAction = state.currentActions.find(a => a.action === action.action);

  if (!selectedAction && action.customText) {
    // Map custom text to intent
    const intent = await mapCustomActionToIntent(action.customText) as Intent;
    selectedAction = {
      action: action.customText,
      summary: "Custom action",
      risk: 'Risky',
      intent
    };
  }

  if (!selectedAction) {
    throw new Error("Invalid action");
  }

  // Compute next turn number (don't modify state)
  const nextTurnNumber = state.turnNumber + 1;

  // Check for triggered events
  const triggeredEvents = await getTriggeredEvents(state);
  const event = triggeredEvents[0] || null;

  // Determine skill check
  let skill = event ? event.skill : mapIntentToSkill(selectedAction.intent);
  let baseDC = event ? event.dc : getBaseDC(selectedAction.risk);
  const dc = calculateDC(baseDC, nextTurnNumber, state.stats.morale);

  // Check for equipped item bonuses
  let skillBonus = 0;
  const equippedItems = await Promise.all(
    state.equippedItems.map(async id => await getItemById(id))
  );
  const validEquippedItems = equippedItems.filter((item): item is NonNullable<typeof item> => item !== undefined);

  for (const item of validEquippedItems) {
    if (item.skillBonus && item.skillBonus.skill === skill) {
      skillBonus += item.skillBonus.bonus;
    }
  }

  // Check for NPC crew affinity bonuses
  for (const npc of state.npcs) {
    const npcSkills = NPC_SKILL_MAPPINGS[npc.name];
    if (npcSkills && npcSkills.includes(skill)) {
      if (npc.affinity >= 2) {
        skillBonus += 2;
      } else if (npc.affinity === 1) {
        skillBonus += 1;
      } else if (npc.affinity <= -1) {
        skillBonus -= 1;
      }
    }
  }

  // Check for advantage (from items)
  const hasAdvantage = validEquippedItems.some(item => 
    item.sceneEffect?.effect.includes('advantage') &&
    item.sceneEffect?.effect.toLowerCase().includes(skill.toLowerCase())
  );

  // Roll dice (deterministic)
  const rng = new SeededRandom(state.seed);
  const roll1 = rng.rollD20(state.id, nextTurnNumber, selectedAction.action);
  const roll2 = hasAdvantage ? rng.rollD20(state.id, nextTurnNumber, selectedAction.action + '-adv') : 0;
  const rawRoll = hasAdvantage ? Math.max(roll1, roll2) : roll1;
  const finalRoll = rawRoll + skillBonus;
  const success = finalRoll >= dc;

  const checks = [{
    skill,
    dc,
    roll: finalRoll,
    success,
    description: ""
  }];

  return {
    selectedAction,
    event,
    skill,
    dc,
    checks,
    success,
    nextTurnNumber
  };
}

/**
 * Compute what the game state will be after applying turn changes (for action generation).
 * This creates a temporary state that reflects stat changes, day progression, etc.
 * 
 * @param state - Current game state
 * @param computed - Computed turn checks and results
 * @param equippedItems - Valid equipped items (already loaded)
 * @returns Temporary state with applied changes
 */
export function computePostTurnState(
  state: GameState,
  computed: {
    selectedAction: any;
    event: EventDefinition | null;
    success: boolean;
    nextTurnNumber: number;
  },
  equippedItems: any[]
): GameState {
  // Create a copy of the state
  const postTurnState: GameState = {
    ...state,
    turnNumber: computed.nextTurnNumber,
    eventHistory: [...state.eventHistory],
    runningGags: [...state.runningGags],
    stats: { ...state.stats }
  };

  // Calculate stat changes (reuse same logic as processTurnLogic)
  let deltaString = '';
  if (computed.event) {
    deltaString = computed.success ? computed.event.passEffect : computed.event.failEffect;
    if (computed.event.id) {
      postTurnState.eventHistory.push(computed.event.id);
    }
  } else {
    // Reuse getActionConsequences function
    deltaString = getActionConsequences(computed.selectedAction, computed.success);
  }

  // Apply item scene effects (reuse same logic)
  const sceneTags = computed.event?.tags || getActionTags(computed.selectedAction.intent);
  for (const item of equippedItems) {
    if (item.sceneEffect) {
      const matchesTags = item.sceneEffect.tags.some((tag: string) => sceneTags.includes(tag));
      if (matchesTags) {
        const effectParts = item.sceneEffect.effect.split('-');
        for (const part of effectParts) {
          if (part.match(/\w+[+-]\d+/)) {
            deltaString += `,${part}`;
          }
        }
      }
    }
  }

  // Apply stat changes
  const { stats: newStats } = applyDelta(postTurnState.stats, deltaString);
  postTurnState.stats = newStats;

  // Advance day every 2 turns and apply daily consumption
  if (computed.nextTurnNumber % 2 === 0) {
    postTurnState.day++;
    postTurnState.segment = getSegment(postTurnState.day);
    
    // Apply daily resource consumption
    const { deltaString: consumptionDelta } = calculateDailyConsumption(equippedItems);
    const { stats: statsAfterConsumption } = applyDelta(postTurnState.stats, consumptionDelta);
    postTurnState.stats = statsAfterConsumption;
  }

  return postTurnState;
}

/**
 * Process a turn action with the given game state.
 * This function contains all the turn processing logic and can be called within a transaction.
 * 
 * Supports two-phase pattern for optimization:
 * - If precomputed content/actions provided: Uses them (no LLM calls inside transaction)
 * - If not provided: Generates content inline (backward compatible, less efficient)
 * 
 * @param state - Current game state
 * @param action - Player action
 * @param precomputed - Optional precomputed turn content and actions (generated outside transaction)
 * @returns Updated game state
 */
export async function processTurnLogic(
  state: GameState,
  action: ActionInput,
  precomputed?: {
    turnContent: TurnContentResult;
    actions: ActionChip[];
    checks: Check[];
    selectedAction: any;
    event: EventDefinition | null;
    skill: string;
    success: boolean;
    userPreferences?: {
      theme?: string;
      style?: string;
      imageModelKey?: string;
      llmModelKey?: string;
      skipImageCache?: boolean;
    };
  },
  client?: DbClient,
): Promise<GameState> {
  // Only load user preferences if not provided in precomputed data
  const userPreferences = precomputed?.userPreferences 
    ? precomputed.userPreferences
    : await storage.getUserPreferences(state.username);

  console.log('[GAME_FLOW] processTurnLogic', {
    action: action.action,
    isIntro: action.action === INTRO_TURN_ACTION_ID,
    turnNumber: state.turnNumber,
    username: state.username,
    hasPrecomputed: !!precomputed,
    userPreferences
  });

  if (action.action === INTRO_TURN_ACTION_ID) {
    console.log('[GAME_FLOW] Routing to processIntroTurn');
    return await processIntroTurn(state, userPreferences, client);
  }

  // When called from orchestrator, precomputed data is always required
  // Legacy fallback path removed - all turn processing should go through orchestrator
  if (!precomputed) {
    throw new Error(`processTurnLogic called without precomputed data. All turn processing must use orchestrator precompute/apply pattern.`);
  }

  // Use precomputed data (no LLM calls inside transaction)
  const selectedAction = precomputed.selectedAction;
  const event = precomputed.event;
  const skill = precomputed.skill;
  const checks = precomputed.checks;
  const success = precomputed.success;
  const turnContent = precomputed.turnContent;
  const narrative = precomputed.turnContent.narration;
  
  console.log('[GAME_FLOW] Using precomputed turn content', {
    hasNarration: !!narrative,
    narrationLength: narrative?.length || 0,
    hasImagePrompt: !!turnContent.imagePrompt
  });

  // Increment turn number (precomputed data always includes nextTurnNumber)
  state.turnNumber++;

  // Load equipped items (needed for stat changes and scene effects)
  // Note: We need to load these even when using precomputed, since we apply stat changes here
  const equippedItems = await Promise.all(
    state.equippedItems.map(async id => await getItemById(id))
  );
  const validEquippedItems = equippedItems.filter((item): item is NonNullable<typeof item> => item !== undefined);

  // Calculate stat changes
  let deltaString = '';
  if (event) {
    deltaString = success ? event.passEffect : event.failEffect;
    if (event.id) {
      state.eventHistory.push(event.id);
    }
  } else {
    // Base consequences based on action risk
    deltaString = getActionConsequences(selectedAction, success);
  }

  // Apply item scene effects
  const sceneTags = event?.tags || getActionTags(selectedAction.intent);
  for (const item of validEquippedItems) {
    if (item.sceneEffect) {
      const matchesTags = item.sceneEffect.tags.some(tag => sceneTags.includes(tag));
      if (matchesTags) {
        const effectParts = item.sceneEffect.effect.split('-');
        for (const part of effectParts) {
          if (part.match(/\w+[+-]\d+/)) {
            deltaString += `,${part}`;
          }
        }
      }
    }
  }

  const { stats: newStats, changes } = applyDelta(state.stats, deltaString);
  state.stats = newStats;

  // Advance day every 2 turns and apply daily consumption
  let consumptionChanges: any[] = [];
  if (state.turnNumber % 2 === 0) {
    state.day++;
    state.segment = getSegment(state.day);
    
    // Apply daily resource consumption
    const { deltaString: consumptionDelta } = calculateDailyConsumption(validEquippedItems);
    const { stats: statsAfterConsumption, changes: clampedChanges } = applyDelta(state.stats, consumptionDelta);
    state.stats = statsAfterConsumption;
    
    // Use clamped changes to ensure deltas match actual stat changes
    consumptionChanges = clampedChanges.map(change => ({
      ...change,
      note: 'Daily consumption'
    }));
  }

  // Check for NPC affinity changes
  updateNPCAffinities(state, skill, success);

  // Add running gag if this is a recurring event
  if (event && event.id && !state.runningGags.includes(event.name)) {
    state.runningGags.push(event.name);
  }

  // Create turn record with combined deltas (action effects + daily consumption)
  const turn: any = {
    turnNumber: state.turnNumber,
    action: selectedAction.action,
    narrative,
    checks,
    delta: [...changes, ...consumptionChanges],
    timestamp: Date.now(),
    imagePrompt: turnContent.imagePrompt || undefined,
    imageStyle: turnContent.style,
    imageMetadata: turnContent.imageMetadata ?? null,
    imageModelKey: turnContent.imageModelKey,
    promptChain: turnContent.promptChain ?? [],
    masterEnrichment: turnContent.masterEnrichment ?? null,
    toneHints: turnContent.toneHints ?? undefined,
    theme: turnContent.theme,
    style: turnContent.style,
    fallbackUsed: turnContent.fallbackUsed ?? false,
    imagePromptSource: turnContent.imagePromptSource
  };
  state.turns.push(turn);

  // Check for fail/win conditions
  const failReason = checkFailState(state.stats);
  if (failReason) {
    state.isComplete = true;
    state.failureReason = failReason;
  } else if (checkWinCondition(state)) {
    state.isComplete = true;
  }

  // Use precomputed actions (always provided when using orchestrator)
  if (!state.isComplete) {
    if (!precomputed.actions || !Array.isArray(precomputed.actions) || precomputed.actions.length === 0) {
      throw new Error(`Precomputed actions missing for turn ${state.turnNumber}. Orchestrator should always provide actions.`);
    }
    state.currentActions = precomputed.actions;
    console.log('[GAME_FLOW] Using precomputed actions', {
      actionsCount: precomputed.actions.length
    });
  }

  return state;
}

/**
 * Process a turn action with transaction safety
 * This is the main entry point for turn processing
 */
export async function processTurnWithTransaction(
  gameId: string,
  action: ActionInput
): Promise<GameState> {
  const { storage } = await import("./storage");
  
  return await storage.processTurnWithTransaction(gameId, async (state, client) => {
    return await processTurnLogic(state, action, undefined, client);
  });
}
