import { useQuery } from '@tanstack/react-query';
import { REFERENCE_DATA_QUERY_OPTIONS } from '@/lib/queryClient';

/** A story (text) model a player may choose. Served by /api/reference/llm-models. */
export interface StoryModelOption {
  modelKey: string;
  displayName: string;
  description: string | null;
  adult: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export function useStoryModels() {
  return useQuery<StoryModelOption[]>({
    queryKey: ['api', 'reference', 'llm-models'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });
}

export interface StoryModelChoice {
  /** The model a theme imposes, if any. The player's choice is ignored while it is set. */
  forced: StoryModelOption | null;
  /** Key to show as selected: the forced model, else the saved choice, else the default. */
  selectedKey: string;
  defaultKey: string;
  /** False when there is nothing to choose (one model and no theme override): hide the control. */
  showPicker: boolean;
}

/**
 * Work out what the story model picker should show.
 * A saved key that is no longer offered falls back to the default, mirroring the server.
 */
export function resolveStoryModelChoice(
  models: StoryModelOption[],
  savedKey: string | null | undefined,
  forcedKey: string | null | undefined
): StoryModelChoice {
  const defaultKey = models.find((m) => m.isDefault)?.modelKey ?? models[0]?.modelKey ?? '';
  const forced = forcedKey ? models.find((m) => m.modelKey === forcedKey) ?? null : null;
  const saved = savedKey && models.some((m) => m.modelKey === savedKey) ? savedKey : '';
  return {
    forced,
    selectedKey: forced?.modelKey ?? (saved || defaultKey),
    defaultKey,
    showPicker: forced !== null || models.length > 1,
  };
}

/**
 * Value to save for a selection. Choosing the default is stored as "" (no explicit choice),
 * so the player keeps following the default if an admin later changes it.
 */
export function storyModelKeyToSave(selectedKey: string, defaultKey: string): string {
  return selectedKey === defaultKey ? '' : selectedKey;
}

export function storyModelLabel(model: StoryModelOption): string {
  return `${model.displayName}${model.adult ? ' · 18+' : ''}${model.isDefault ? ' (Default)' : ''}`;
}
