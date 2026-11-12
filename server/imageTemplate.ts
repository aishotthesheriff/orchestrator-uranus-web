import type { GameState, Intent } from "@shared/schema";

export function selectImageTemplate(state: GameState, event?: any): string {
  // Segment-based selection
  if (state.segment === 'Launch from Earth') {
    return 'day_launch';
  }
  if (state.segment === 'Arrival on Uranus') {
    return 'day_arrival';
  }

  // Event-based selection
  if (event) {
    const tags = event.tags || [];
    if (tags.includes('technical')) return 'technical_problem';
    if (tags.includes('cosmic')) return 'cosmic_encounter';
    if (tags.includes('crisis')) return 'crisis_moment';
  }

  // Content-based selection (check last narrative)
  if (state.turns.length > 0) {
    const lastNarrative = state.turns[state.turns.length - 1].narrative.toLowerCase();
    if (lastNarrative.includes('crew') && lastNarrative.includes('yell')) {
      return 'character_interaction';
    }
  }

  // Default fallback
  return 'general_scene';
}

export function mapIntentToSkill(intent: Intent): any {
  const mapping = {
    repair: 'Engineering',
    negotiate: 'Diplomacy',
    cook: 'Culinary',
    explore: 'Piloting',
    improvise: 'Vibes',
    research: 'Bureaucracy',
    command: 'Deception',
    other: 'Vibes'
  } as const;
  return (mapping as any)[intent] || 'Vibes';
}

