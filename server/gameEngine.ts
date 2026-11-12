import type { GameState, GameStats, Skill, Segment, NPC, Item, Check, EventDefinition } from "@shared/schema";
import { getCurrentReference } from "./reference/referenceLoader";

// Helper functions to replace cache functions
type RawTriggerCondition = EventDefinition["triggerCondition"] | string | null | undefined;

function normalizeTriggerCondition(eventId: string, eventName: string, rawCondition: RawTriggerCondition): EventDefinition["triggerCondition"] | null {
  if (!rawCondition) {
    console.warn(`[getActiveEvents] Skipping event ${eventId} (${eventName}) with missing triggerCondition`);
    return null;
  }

  let parsedCondition: unknown = rawCondition;

  if (typeof rawCondition === 'string') {
    try {
      parsedCondition = JSON.parse(rawCondition);
    } catch (error) {
      console.warn(`[getActiveEvents] Skipping event ${eventId} (${eventName}) with invalid triggerCondition JSON`, error);
      return null;
    }
  }

  if (typeof parsedCondition !== 'object' || parsedCondition === null) {
    console.warn(`[getActiveEvents] Skipping event ${eventId} (${eventName}) with non-object triggerCondition`, parsedCondition);
    return null;
  }

  const condition = parsedCondition as Record<string, unknown>;
  if (typeof condition.type !== 'string') {
    console.warn(`[getActiveEvents] Skipping event ${eventId} (${eventName}) with missing triggerCondition.type`, condition);
    return null;
  }

  return condition as EventDefinition["triggerCondition"];
}

async function getActiveEvents(): Promise<EventDefinition[]> {
  const reference = await getCurrentReference();
  return reference.data.events
    .map(event => {
    // Handle both camelCase (triggerCondition) and snake_case (trigger_condition) formats
    // This handles cases where JSON files might have either format
    const triggerCondition = event.triggerCondition ?? event.trigger_condition;
    const normalizedTriggerCondition = normalizeTriggerCondition(event.id, event.name, triggerCondition);
    if (!normalizedTriggerCondition) {
      return null;
    }

    return {
      id: event.id,
      name: event.name,
      segment: event.segment as any,
      tags: event.tags as string[],
      triggerCondition: normalizedTriggerCondition as any,
      skill: event.skill as any,
      dc: event.dc,
      passEffect: event.passEffect ?? event.pass_effect,
      failEffect: event.failEffect ?? event.fail_effect,
      active: event.active === 1,
    };
    })
    .filter((event): event is EventDefinition => event !== null);
}

async function getActiveItems(): Promise<Item[]> {
  const reference = await getCurrentReference();
  return reference.data.items
    .filter(item => item.active === 1)
    .map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      icon: item.icon,
      skillBonus: item.skillBonusSkill && item.skillBonusValue 
        ? { skill: item.skillBonusSkill as any, bonus: item.skillBonusValue }
        : undefined,
      sceneEffect: item.sceneEffectTags && item.sceneEffectEffect
        ? { tags: item.sceneEffectTags as string[], effect: item.sceneEffectEffect }
        : undefined,
      efficiency: item.efficiency
    }));
}

export async function getItemById(id: string): Promise<Item | undefined> {
  const reference = await getCurrentReference();
  const item = reference.data.items.find(item => item.id === id);
  if (!item || item.active !== 1) return undefined;
  
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    skillBonus: item.skillBonusSkill && item.skillBonusValue 
      ? { skill: item.skillBonusSkill as any, bonus: item.skillBonusValue }
      : undefined,
    sceneEffect: item.sceneEffectTags && item.sceneEffectEffect
      ? { tags: item.sceneEffectTags as string[], effect: item.sceneEffectEffect }
      : undefined,
    efficiency: item.efficiency
  };
}

export async function getInitialNpcs(): Promise<NPC[]> {
  const reference = await getCurrentReference();
  return reference.data.npcs.map(npc => ({
    id: npc.id,
    name: npc.name,
    role: npc.role,
    affinity: npc.startingAffinity || 0,
    status: 'Indifferent' as const,
  }));
}

// Event trigger condition evaluation
function evaluateTriggerCondition(event: EventDefinition, state: GameState): boolean {
  const condition = event.triggerCondition;
  
  // Defensive check: if triggerCondition is missing, event should not trigger
  if (!condition || typeof condition !== 'object' || !('type' in condition)) {
    console.warn(`[gameEngine] Event ${event.id} (${event.name}) has invalid triggerCondition:`, condition);
    return false;
  }
  
  switch (condition.type) {
    case 'stat': {
      const statValue = state.stats[condition.stat];
      switch (condition.operator) {
        case '>=': return statValue >= condition.value;
        case '<=': return statValue <= condition.value;
        case '>': return statValue > condition.value;
        case '<': return statValue < condition.value;
        case '==': return statValue === condition.value;
        default: return false;
      }
    }
    case 'day_modulo': {
      return state.day % condition.divisor === condition.remainder;
    }
    case 'random': {
      return Math.random() < condition.chance;
    }
    case 'or': {
      return condition.conditions.some(c => evaluateTriggerCondition({ ...event, triggerCondition: c }, state));
    }
    case 'and': {
      return condition.conditions.every(c => evaluateTriggerCondition({ ...event, triggerCondition: c }, state));
    }
    default:
      return false;
  }
}

// Seeded RNG for deterministic dice rolls
export class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashString(seed);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  rollD20(gameId: string, turn: number, context: string): number {
    const contextSeed = `${gameId}-${turn}-${context}`;
    const rng = new SeededRandom(contextSeed);
    return rng.nextInt(1, 20);
  }
}

// Items and NPCs are now loaded from database via caches
// Use getActiveItems() to get all items
// Use getItemById(id) to get a specific item
// Use getInitialNpcs() to get crew members for new games

// Daily Resource Consumption Configuration
export const DAILY_CONSUMPTION = {
  oxygen: 3,
  fuel: 4,
  food: 3,
  morale: 2
} as const;

// Calculate daily consumption with item efficiency modifiers
export function calculateDailyConsumption(equippedItems: Item[]): { deltaString: string; changes: any[] } {
  const consumption: Record<string, number> = {
    oxygen: DAILY_CONSUMPTION.oxygen,
    fuel: DAILY_CONSUMPTION.fuel,
    food: DAILY_CONSUMPTION.food,
    morale: DAILY_CONSUMPTION.morale
  };
  
  // Apply efficiency modifiers from equipped items
  for (const item of equippedItems) {
    if (item.efficiency) {
      for (const [resource, reduction] of Object.entries(item.efficiency)) {
        if (resource in consumption && typeof reduction === 'number') {
          consumption[resource] = Math.max(0, consumption[resource] - reduction);
        }
      }
    }
  }
  
  // Build delta string (negative values for consumption)
  const parts: string[] = [];
  const changes: any[] = [];
  
  for (const [resource, amount] of Object.entries(consumption)) {
    if (amount > 0) {
      parts.push(`${resource}-${amount}`);
      changes.push({ 
        stat: resource.charAt(0).toUpperCase() + resource.slice(1), 
        change: -amount,
        note: 'Daily consumption'
      });
    }
  }
  
  return { 
    deltaString: parts.join(','),
    changes 
  };
}

// Segment progression
export function getSegment(day: number): Segment {
  if (day == 1) return 'Launch from Earth';
  if (day == 2) return 'Moon Flyby';
  if (day <= 4) return 'Onto to Mars';
  if (day == 5) return 'Asteroid Belt';
  if (day <= 7) return 'Jupiter & Saturn';
  if (day <= 10) return 'Outer Darkness';
  if (day < 12) return 'Approaching Uranus';
  if (day === 12) return 'Arrival on Uranus';
  return 'Lost';
}

// DC scaling
export function calculateDC(baseDC: number, turnNumber: number, morale: number): number {
  let dc = baseDC;
  
  // DC increases by 1 every 3 turns (turn 3, 6, 9, 12, etc.)
  const turnIncrease = Math.floor(turnNumber / 3);
  dc += turnIncrease;
  
  // Low morale (below 30) makes checks harder
  if (morale < 30) {
    dc += 1;
  }
  
  return dc;
}

// Check stat boundaries
export function clampStat(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

// Check for fail states
export function checkFailState(stats: GameStats): string | null {
  if (stats.hull <= 0) return "Ship folded into modern art.";
  if (stats.oxygen <= 0) return "Everyone discovers mindfulness too late.";
  if (stats.morale <= 0) return "Crew quits to start a space bakery.";
  if (stats.weirdness >= 5) return "Cosmic HR freezes reality for an audit.";
  return null;
}

// Check for win condition
export function checkWinCondition(state: GameState): boolean {
  return state.day >= 12 && state.segment === 'Arrival on Uranus' &&
    (state.stats.hull >= 30 || state.stats.oxygen >= 30 ||
     state.stats.fuel >= 30 || state.stats.food >= 30 ||
     state.stats.morale >= 30);
}

// Get triggered events
export async function getTriggeredEvents(state: GameState): Promise<EventDefinition[]> {
  const activeEvents = await getActiveEvents();
  return activeEvents.filter(event => {
    // Filter out events with missing or invalid triggerCondition
    if (!event.triggerCondition || typeof event.triggerCondition !== 'object' || !('type' in event.triggerCondition)) {
      console.warn(`[getTriggeredEvents] Skipping event ${event.id} (${event.name}) with invalid triggerCondition`);
      return false;
    }
    
    if (event.segment !== 'Any' && event.segment !== state.segment) {
      return false;
    }
    try {
      return evaluateTriggerCondition(event, state);
    } catch (error) {
      console.error(`[getTriggeredEvents] Failed to evaluate event ${event.id} (${event.name})`, error, event.triggerCondition);
      return false;
    }
  });
}

// Apply stat changes from delta string
export function applyDelta(stats: GameStats, deltaString: string): { stats: GameStats; changes: any[] } {
  const newStats = { ...stats };
  const changes: any[] = [];

  const parts = deltaString.split(',');
  for (const part of parts) {
    const match = part.match(/(\w+)([+-]\d+)/);
    if (match) {
      const [, stat, change] = match;
      const value = parseInt(change);
      
      if (stat === 'weirdness') {
        newStats.weirdness = clampStat(newStats.weirdness + value, 0, 5);
        changes.push({ stat: 'Weirdness', change: value });
      } else if (stat in newStats) {
        const key = stat as keyof GameStats;
        newStats[key] = clampStat((newStats[key] as number) + value);
        changes.push({ stat: stat.charAt(0).toUpperCase() + stat.slice(1), change: value });
      }
    }
  }

  return { stats: newStats, changes };
}
