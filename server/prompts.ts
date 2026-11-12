import type { GameState, ActionChip, Turn, Skill } from "@shared/schema";

export function getSystemPrompt(): string {
  return `You are the narrator for "Quest to Uranus", a comedic space adventure game.

TONE:
- Blend "Hitchhiker's Guide to the Galaxy" cosmic irony with "Beavis & Butt-Head" juvenile misunderstandings
- Always PG-13: innuendo allowed, but never explicit
- Violence stays Looney Tunes
- Use witty omniscient narrator voice; NEVER second-person commands to the player

NARRATIVE RULES:
1. Write 4-8 sentences of narrative prose
2. Include 1-2 inline skill checks when appropriate
3. End with a Δ (delta) line showing stat changes
4. Weave in NPC interactions based on their affinity
5. Reference running gags and previous turns for callback humor
6. Keep it snackable and engaging

SKILLS: Bureaucracy, Engineering, Piloting, Culinary, Diplomacy, Deception, Vibes

RUNNING GAG PALETTE:
- Paperwork Singularity
- Coffee Machine Union
- Cosmic HOA
- Quantum phenomena with comedic names
- Bureaucratic Snail
- Nebula Parking Violations

SAFETY:
- If player tries something inappropriate, activate "Cosmic HR" intervention
- Provide gentle comedic deflection, not lectures
- Always maintain the fun, absurd tone`;
}

export function getTurnGenerationPrompt(state: GameState, playerAction: string, checks: any[]): string {
  const recentTurns = state.turns.slice(-3).map(t => 
    `Turn ${t.turnNumber}: ${t.narrative.substring(0, 150)}...`
  ).join('\n');

  const equippedItems = state.equippedItems.map(id => `Item ${id}`);

  const npcSummary = state.npcs.map(npc => 
    `${npc.name}: ${npc.affinity > 0 ? 'Warm' : npc.affinity < 0 ? 'Cold' : 'Neutral'} (${npc.status})`
  ).join(', ');

  return `Generate narrative for Turn ${state.turnNumber + 1}.

CURRENT SITUATION:
- Day ${state.day}, Segment: ${state.segment}
- Hull ${state.stats.hull}/100, Oxygen ${state.stats.oxygen}/100, Fuel ${state.stats.fuel}/100
- Food ${state.stats.food}/100, Morale ${state.stats.morale}/100, Weirdness ${state.stats.weirdness}/5
- Equipped Items: ${equippedItems.join(', ') || 'None'}
- NPCs: ${npcSummary}

PLAYER ACTION: "${playerAction}"

SKILL CHECK RESULTS:
${checks.map((c) => `- ${c.skill} DC${c.dc}: Rolled ${c.roll} ${c.success ? '✅ SUCCESS' : '❌ FAIL'}`).join('\n')}

RECENT CONTEXT:
${recentTurns || 'This is the first turn.'}

RUNNING GAGS IN PLAY:
${state.runningGags.slice(0, 3).join(', ') || 'None yet'}

Generate a narrative that:
1. Describes what happened based on the player's action
2. Incorporates the skill check results naturally (show the roll and DC inline)
3. Includes at least one NPC reaction or interaction
4. References a running gag or creates a new one
5. Sets up consequences (good or bad)
6. Stays true to the ${state.segment} segment's atmosphere

Output ONLY the narrative text (4-8 sentences). Do not include turn numbers, labels, or delta lines.`;
}

export function getActionGenerationPrompt(state: GameState): string {
  const triggeredEvents = state.eventHistory.slice(-1)[0] || 'routine space operations';
  
  const criticalStats = [];
  if (state.stats.hull < 40) criticalStats.push('hull is low');
  if (state.stats.oxygen < 40) criticalStats.push('oxygen is low');
  if (state.stats.fuel < 40) criticalStats.push('fuel is low');
  if (state.stats.food < 40) criticalStats.push('food is low');
  if (state.stats.morale < 40) criticalStats.push('morale is low');
  if (state.stats.weirdness >= 4) criticalStats.push('weirdness is critical');

  const equippedItems = state.equippedItems.map(id => ({ id }));

  const lastNarrative = state.turns[state.turns.length - 1]?.narrative || 'The journey to Uranus begins.';

  return `Generate 6 action options for the player.

CURRENT SITUATION:
- Day ${state.day}, Turn ${state.turnNumber}, Segment: ${state.segment}
- Recent event: ${triggeredEvents}
- Critical issues: ${criticalStats.join(', ') || 'None'}
- Last turn: "${lastNarrative.substring(0, 200)}..."

EQUIPPED ITEMS:
${equippedItems.map((item) => `- ${item.id}`).join('\n') || '- None'}

Generate 6 actions that:
1. Are contextual to the current situation and recent narrative
2. Include a mix of risk levels (2 Safe, 2 Risky, 2 Wild)
3. Reference equipped items where relevant (show the item icon)
4. Map to these intents: repair, negotiate, cook, explore, improvise, research, command, other
5. Are specific and comedic, fitting the ${state.segment} segment
6. Address critical issues when appropriate

For each action, provide:
- action: Short description (under 50 chars)
- summary: Consequence hint (under 80 chars)  
- risk: "Safe", "Risky", or "Wild"
- intent: One of the mapped intents
- usesItemId: (optional) Item ID if action uses an equipped item

Format as JSON array of 6 action objects. Example:
[
  {
    "action": "Repair hull with duct tape",
    "summary": "Not elegant, but it's worked before. Probably.",
    "risk": "Safe",
    "intent": "repair",
    "usesItemId": "universal_allen_key"
  }
]

Output ONLY the JSON array, no other text.`;
}

export function getIntentMappingPrompt(customText: string): string {
  return `Map this player input to one of these intents: repair, negotiate, cook, explore, improvise, research, command, other

Player input: "${customText}"

Respond with ONLY the intent word, nothing else.`;
}
