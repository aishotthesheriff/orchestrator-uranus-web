import { getCurrentReference } from "../reference/referenceLoader.js";
import { storage } from "../storage.js";
import type { ModStoryThemes, ModVisualStyles } from "@shared/schema";

/**
 * Represents a resolved PCE theme/style selection pair.
 */
export interface PceSelection {
  theme: string;
  style: string;
}

function parseJsonSetting<T>(value: string | undefined, key: string): T {
  if (!value) {
    throw new Error(`App setting '${key}' is missing`);
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`App setting '${key}' contains invalid JSON`);
  }
}

function normalizeDefaults(value: unknown): PceSelection {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as any).theme !== "string" ||
    typeof (value as any).style !== "string"
  ) {
    throw new Error("App setting 'pce_defaults' must provide theme and style strings");
  }

  return {
    theme: ((value as any).theme as string).trim(),
    style: ((value as any).style as string).trim(),
  };
}

function resolveSelectionValue(
  value: string | undefined,
  catalog: (ModStoryThemes | ModVisualStyles)[],
  idField: 'storyThemeKey' | 'visualStyleKey', // 'storyThemeKey' for themes, 'visualStyleKey' for styles
  fallback: string,
  key: string
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    console.log(`[PCE] resolveSelectionValue: no value provided for ${key}, using fallback: ${fallback}`);
    return fallback;
  }

  // Match by id field (storyThemeKey for themes, visualStyleKey for styles)
  const byId = catalog.find(item => {
    const itemKey = idField === 'storyThemeKey'
      ? (item as ModStoryThemes).storyThemeKey
      : (item as ModVisualStyles).visualStyleKey;
    return (itemKey ?? '').toLowerCase() === trimmed.toLowerCase();
  });
  if (byId) {
    console.log(`[PCE] resolveSelectionValue: matched ${key} by ${idField}`, { input: trimmed, matchedKey: idField === 'storyThemeKey' ? (byId as ModStoryThemes).storyThemeKey : (byId as ModVisualStyles).visualStyleKey, returnedLabel: byId.label });
    return byId.label;
  }

  // Match by label
  const byLabel = catalog.find(item => item.label.toLowerCase() === trimmed.toLowerCase());
  if (byLabel) {
    console.log(`[PCE] resolveSelectionValue: matched ${key} by label`, { input: trimmed, returnedLabel: byLabel.label });
    return byLabel.label;
  }

  // Stale/unknown preference (e.g. removed from the active release): fall back to the
  // system default instead of failing the whole turn later.
  console.warn(`[PCE] Value '${trimmed}' for ${key} not found in catalog; falling back to default '${fallback}'. Available: ${catalog.map(item => `${item.label} (${idField === 'storyThemeKey' ? (item as ModStoryThemes).storyThemeKey : (item as ModVisualStyles).visualStyleKey})`).join(', ')}`);
  if (trimmed.toLowerCase() === fallback.toLowerCase()) return trimmed;
  return resolveSelectionValue(fallback, catalog, idField, fallback, key);
}

/**
 * Reads the active reference and returns the default PCE theme/style pair from system_defaults.
 */
export async function getPceDefaults(): Promise<PceSelection> {
  const reference = await getCurrentReference();
  
  if (reference.data.system_defaults) {
    const systemDefaults = reference.data.system_defaults;
    if (systemDefaults.visual_style_key && systemDefaults.story_theme_key) {
      return {
        theme: systemDefaults.story_theme_key.trim(),
        style: systemDefaults.visual_style_key.trim(),
      };
    }
  }

  throw new Error("No PCE defaults found in system_defaults");
}

/**
 * Resolves the final PCE selections using overrides and the configured defaults
 * while ensuring the resulting labels exist in the currently active theme/style catalogs.
 */
export async function resolvePceSelections(
  overrides: Partial<PceSelection>
): Promise<PceSelection> {
  // Fetch from mod tables directly
  const themesData = await storage.listStoryThemes();
  const stylesData = await storage.listVisualStyles();
  
  // Filter to only active items
  const activeThemes = themesData.filter(t => t.active === 1);
  const activeStyles = stylesData.filter(s => s.active === 1);

  // Get defaults
  const defaults = await getPceDefaults();

  const theme = resolveSelectionValue(
    overrides.theme,
    activeThemes,
    'storyThemeKey',
    defaults.theme,
    "theme"
  );

  const style = resolveSelectionValue(
    overrides.style,
    activeStyles,
    'visualStyleKey',
    defaults.style,
    "style"
  );

  return { theme, style };
}
