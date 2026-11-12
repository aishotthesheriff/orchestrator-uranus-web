import { createHash } from 'crypto';
import type { GameState } from '@shared/schema';

export interface ImageSettings {
  size: string;
  quality: string;
  background: string;
  moderation: string;
}

export interface SceneFingerprint {
  templateName: string;
  sceneTypes: string[];
  tags: string[];
  narrativeContext: {
    segment: string;
    day: number;
    absurdity: number;
    narrative: string;
  };
  gameState: {
    stats: Record<string, number>;
    npcs: string[];
    equippedItems: string[];
  };
  playerAction: string; // Player's action for this turn
  visualSettings: ImageSettings;
}

export interface SceneSimilarity {
  exactMatch: boolean;
  templateMatch: boolean;
  narrativeSimilarity: number;  // 0-1 score
  contextSimilarity: number;    // 0-1 score
  actionSimilarity: number;    // 0-1 score (player action)
  visualSimilarity: number;     // 0-1 score
  overallSimilarity: number;    // 0-1 score
}

function intersectionSize<T>(setA: Set<T>, setB: Set<T>): number {
  let count = 0;
  setA.forEach(value => {
    if (setB.has(value)) {
      count += 1;
    }
  });
  return count;
}

function unionSize<T>(setA: Set<T>, setB: Set<T>): number {
  const union = new Set<T>();
  setA.forEach(value => union.add(value));
  setB.forEach(value => union.add(value));
  return union.size;
}

export function generatePromptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

export function generateVariablesHash(variables: Record<string, any>): string {
  // Sort keys to ensure consistent hashing
  const sortedEntries = Object.entries(variables).sort(([a], [b]) => a.localeCompare(b));
  const serialized = JSON.stringify(sortedEntries);
  return createHash('sha256').update(serialized).digest('hex');
}

export function generateCacheKey(
  templateName: string,
  variables: Record<string, any>,
  settings: ImageSettings
): string {
  const promptHash = generatePromptHash(JSON.stringify(variables));
  const settingsHash = createHash('sha256')
    .update(JSON.stringify(settings))
    .digest('hex')
    .substring(0, 8);

  return `${templateName}:${promptHash.substring(0, 16)}:${settingsHash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidSceneFingerprint(value: unknown): value is SceneFingerprint {
  if (!isRecord(value)) {
    return false;
  }

  const fingerprint = value as Partial<SceneFingerprint>;
  if (typeof fingerprint.templateName !== 'string') {
    return false;
  }

  if (!isRecord(fingerprint.narrativeContext)) {
    return false;
  }

  const narrativeContext = fingerprint.narrativeContext as Partial<SceneFingerprint["narrativeContext"]>;
  if (typeof narrativeContext.narrative !== 'string') {
    return false;
  }

  if (!isRecord(fingerprint.gameState)) {
    return false;
  }

  if (!isRecord(fingerprint.visualSettings)) {
    return false;
  }

  // playerAction is optional for backward compatibility with existing cached images
  // It will be undefined/null for old fingerprints, which is fine

  return true;
}

export function generateSceneFingerprint(
  templateName: string,
  gameState: GameState,
  variables: Record<string, any>,
  settings: ImageSettings,
  templateSceneTypes: string[] = [],
  templateTags: string[] = []
): SceneFingerprint {
  const statsRecord = Object.fromEntries(
    Object.entries(gameState.stats).map(([key, value]) => [key, Number(value)])
  ) as Record<string, number>;

  // Extract player action from variables or the most recent turn
  // For regular turns, PLAYER_ACTION should be in variables
  // For intro turns, it will be "Beginning the voyage to Uranus."
  // Fallback to the most recent turn's action if not in variables
  const playerAction = variables.PLAYER_ACTION || 
    (gameState.turns.length > 0 && gameState.turns[gameState.turns.length - 1].action 
      ? gameState.turns[gameState.turns.length - 1].action 
      : '');

  return {
    templateName,
    sceneTypes: templateSceneTypes,
    tags: templateTags,
    narrativeContext: {
      segment: gameState.segment,
      day: gameState.day,
      absurdity: gameState.absurdity,
      narrative: variables.CURRENT_NARRATIVE || ''
    },
    gameState: {
      stats: statsRecord,
      npcs: gameState.npcs.map(npc => npc.name),
      equippedItems: gameState.equippedItems
    },
    playerAction: playerAction || '',
    visualSettings: settings
  };
}

export function calculateTextSimilarity(text1: string, text2: string): number {
  if (text1 === text2) return 1.0;
  if (!text1 || !text2) return 0.0;

  // Simple word-based similarity
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersectionCount = intersectionSize(words1, words2);
  const unionCount = unionSize(words1, words2);

  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

export function calculateObjectSimilarity(obj1: any, obj2: any): number {
  if (obj1 === obj2) return 1.0;
  if (!obj1 || !obj2) return 0.0;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length === 0 && keys2.length === 0) return 1.0;
  if (keys1.length === 0 || keys2.length === 0) return 0.0;

  const commonKeys = keys1.filter(key => keys2.includes(key));
  if (commonKeys.length === 0) return 0.0;

  let totalSimilarity = 0;
  for (const key of commonKeys) {
    const val1 = obj1[key];
    const val2 = obj2[key];

    if (typeof val1 === 'string' && typeof val2 === 'string') {
      totalSimilarity += calculateTextSimilarity(val1, val2);
    } else if (typeof val1 === 'number' && typeof val2 === 'number') {
      // For numbers, calculate similarity based on relative difference
      const max = Math.max(val1, val2);
      const min = Math.min(val1, val2);
      totalSimilarity += max === 0 ? 1.0 : min / max;
    } else if (Array.isArray(val1) && Array.isArray(val2)) {
      // For arrays, calculate Jaccard similarity
      const set1 = new Set(val1);
      const set2 = new Set(val2);
      const arrayUnionSize = unionSize(set1, set2);
      const arrayIntersectionSize = intersectionSize(set1, set2);
      totalSimilarity += arrayUnionSize === 0 ? 1.0 : arrayIntersectionSize / arrayUnionSize;
    } else if (typeof val1 === 'object' && typeof val2 === 'object') {
      totalSimilarity += calculateObjectSimilarity(val1, val2);
    } else {
      totalSimilarity += val1 === val2 ? 1.0 : 0.0;
    }
  }

  return totalSimilarity / commonKeys.length;
}

export function calculateSceneSimilarity(
  fingerprint1: SceneFingerprint,
  fingerprint2: SceneFingerprint
): SceneSimilarity {
  const exactMatch = fingerprint1.templateName === fingerprint2.templateName &&
    JSON.stringify(fingerprint1.narrativeContext) === JSON.stringify(fingerprint2.narrativeContext) &&
    JSON.stringify(fingerprint1.gameState) === JSON.stringify(fingerprint2.gameState) &&
    fingerprint1.playerAction === fingerprint2.playerAction &&
    JSON.stringify(fingerprint1.visualSettings) === JSON.stringify(fingerprint2.visualSettings);

  const templateMatch = fingerprint1.templateName === fingerprint2.templateName;

  const narrativeSimilarity = calculateTextSimilarity(
    fingerprint1.narrativeContext.narrative,
    fingerprint2.narrativeContext.narrative
  );

  const contextSimilarity = calculateObjectSimilarity(
    fingerprint1.gameState,
    fingerprint2.gameState
  );

  // Calculate action similarity separately with higher weight
  // Handle blank/empty actions specially to encourage cache misses:
  // - If either action is blank: always cache miss (0.0) - blank actions should always generate new images
  // - If both have actions: calculate text similarity normally (different actions should miss)
  const action1 = (fingerprint1.playerAction || '').trim();
  const action2 = (fingerprint2.playerAction || '').trim();
  
  let actionSimilarity: number;
  if (!action1 || !action2) {
    // Any blank action causes cache miss - blank actions should always get unique images
    actionSimilarity = 0.0;
  } else {
    // Both have actions - calculate text similarity
    // If actions are different, this will be low, causing cache miss
    actionSimilarity = calculateTextSimilarity(action1, action2);
  }

  const visualSimilarity = calculateObjectSimilarity(
    fingerprint1.visualSettings,
    fingerprint2.visualSettings
  );

  // Weighted average with action getting higher weight to encourage cache misses for different actions
  // Adjusted weights: action (35%), narrative (25%), context (15%), visual (15%), template (10%)
  // Higher action weight means different actions will more easily drop below 85% threshold
  const overallSimilarity = (
    actionSimilarity * 0.35 +
    narrativeSimilarity * 0.25 +
    contextSimilarity * 0.15 +
    visualSimilarity * 0.15 +
    (templateMatch ? 0.10 : 0)
  );

  return {
    exactMatch,
    templateMatch,
    narrativeSimilarity,
    contextSimilarity,
    actionSimilarity,
    visualSimilarity,
    overallSimilarity
  };
}

export function findSimilarScenes(
  targetFingerprint: SceneFingerprint,
  candidateFingerprints: SceneFingerprint[],
  threshold: number = 0.7
): Array<{ fingerprint: SceneFingerprint; similarity: SceneSimilarity }> {
  const validCandidates = candidateFingerprints.filter(fingerprint => {
    const isValid = isValidSceneFingerprint(fingerprint as unknown);
    if (!isValid) {
      console.warn('[findSimilarScenes] Skipping candidate with invalid scene fingerprint', fingerprint);
    }
    return isValid;
  });

  const similarities = validCandidates
    .map(fingerprint => ({
      fingerprint,
      similarity: calculateSceneSimilarity(targetFingerprint, fingerprint)
    }))
    .filter(({ similarity }) => similarity.overallSimilarity >= threshold)
    .sort((a, b) => b.similarity.overallSimilarity - a.similarity.overallSimilarity);

  return similarities;
}
