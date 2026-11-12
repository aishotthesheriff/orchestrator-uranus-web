export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  systemContent: string | null;
  inheritGlobalPrompt: number;
  description: string | null;
  version: number;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface LlmLog {
  id: string;
  functionName: string;
  prompt: string;
  response: string;
  metadata: any;
  executionTimeMs: number | null;
  gameId: string | null;
  turnNumber: number | null;
  createdAt: string;
}

export interface Event {
  id: string;
  name: string;
  segment: string;
  skill: string;
  dc: number;
  triggerCondition: string;
  passEffect: string;
  failEffect: string;
  tags: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  icon: string;
  skillBonus: any | null;
  sceneEffect: any | null;
  tags: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface NpcTemplate {
  id: string;
  name: string;
  role: string;
  personality: string;
  quirk: string;
  icon: string;
  tags: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImagePrompt {
  id: string;
  name: string;
  promptTemplate: string;
  inheritVisualStyle: number;
  size: string;
  quality: string;
  description: string | null;
  sceneTypes: string | null;
  tags: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  description: string | null;
  active: number;
  updatedAt?: string;
}

export interface ModStoryTheme {
  id: string;
  storyThemeKey: string;
  label: string;
  narratorTemplate: string;
  tags: string;
  active: number;
  rank: number | null;
  default: boolean;
  /** Admin: story model this theme forces (catalog key), or null. */
  llmModelKey?: string | null;
  /** Public reference list only: the forced model, when it is one players can use. */
  forcedLlmModelKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModVisualStyle {
  id: string;
  category: string;
  visualStyleKey: string;
  label: string;
  exemplifiedBy: string;
  modifiersDiffusion: string | null;
  modifiersTransformer: string | null;
  active: number;
  rank: number | null;
  default: boolean;
  createdAt: string;
  updatedAt: string;
}
