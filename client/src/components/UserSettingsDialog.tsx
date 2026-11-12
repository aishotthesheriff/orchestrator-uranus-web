import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { REFERENCE_DATA_QUERY_OPTIONS } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ModStoryTheme, ModVisualStyle } from "@/pages/devtools/types";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import {
  resolveStoryModelChoice,
  storyModelKeyToSave,
  storyModelLabel,
  useStoryModels,
} from "@/hooks/useStoryModels";
import type { GameState } from "@shared/schema";

interface ImageModel {
  modelKey: string;
  displayName?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
}

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  idPrefix?: string;
}

export function UserSettingsDialog({
  open,
  onOpenChange,
  idPrefix = "user-settings",
}: UserSettingsDialogProps) {
  const [, setLocation] = useLocation();
  
  // Phase 1 & 2: Fetch user settings from the database
  const { data: userSettings } = useUserSettings();
  const updateUserPreferencesMutation = useUpdateUserSettings();
  
  // Get username for fetching games
  const username = typeof window !== 'undefined' ? localStorage.getItem('quest-to-uranus-username') : null;
  
  // Fetch user's games to get current game ID for navigation
  const { data: userGames } = useQuery<GameState[]>({
    queryKey: ['api', 'games', 'user', username],
    enabled: !!username,
  });

  const { data: themesData = [], isLoading: loadingThemes } = useQuery<ModStoryTheme[]>({
    queryKey: ['api', 'reference', 'story-themes'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  const { data: stylesData = [], isLoading: loadingStyles } = useQuery<ModVisualStyle[]>({
    queryKey: ['api', 'reference', 'visual-styles'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  // Local state for form values
  const themeOptions = themesData;
  const styleOptions = stylesData;

  // Phase 1: Initialize form state (will be updated by Phase 2 effect when data loads)
  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState("");
  const [imageModelKey, setImageModelKey] = useState("");
  // Story model picked in this dialog; null until the player touches the control.
  const [storyModelPick, setStoryModelPick] = useState<string | null>(null);
  const { data: storyModels = [] } = useStoryModels();

  // Fetch image models from reference API
  const { data: imageModelsData = [] } = useQuery<ImageModel[]>({
    queryKey: ['api', 'reference', 'image-models'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  // Normalize and sort image models (now all camelCase from reference)
  const imageModels = useMemo(() => {
    return imageModelsData
      .map((model) => ({
        modelKey: model.modelKey,
        displayName: model.displayName || '',
        isDefault: model.isDefault ?? false,
        sortOrder: model.sortOrder ?? 0,
      }))
      .filter((model) => model.modelKey) // Only include models with a key
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.modelKey.localeCompare(b.modelKey);
      });
  }, [imageModelsData]);

  // Fetch system defaults to get default image model key
  const { data: systemDefaultsData } = useQuery<{ 
    image_model_key?: string; 
    visual_style_key?: string; 
    story_theme_key?: string;
  }>({
    queryKey: ['api', 'reference', 'system-defaults'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  const defaultThemeValue = useMemo(() => {
    const defaultKey = systemDefaultsData?.story_theme_key?.trim() || "";
    if (!defaultKey) return "";
    const match = themeOptions.find(
      (option) =>
        option.storyThemeKey === defaultKey ||
        option.label === defaultKey
    );
    return match?.storyThemeKey ?? "";
  }, [systemDefaultsData?.story_theme_key, themeOptions]);

  const defaultStyleValue = useMemo(() => {
    const defaultKey = systemDefaultsData?.visual_style_key?.trim() || "";
    if (!defaultKey) return "";
    const match = styleOptions.find(
      (option) =>
        option.visualStyleKey === defaultKey ||
        option.label === defaultKey
    );
    return match?.visualStyleKey ?? "";
  }, [systemDefaultsData?.visual_style_key, styleOptions]);

  const defaultImageModelKey = useMemo(() => {
    if (systemDefaultsData?.image_model_key) {
      return systemDefaultsData.image_model_key;
    }
    return '';
  }, [systemDefaultsData?.image_model_key]);

  // Phase 2 & 2a: Update dropdowns when user settings are loaded from GET /api/user/preferences
  // This handles both Phase 1 (defaults) and Phase 2a (user preferences override)
  useEffect(() => {
    // If user has saved preferences, use those; otherwise use system defaults
    // Normalize saved values (they may be labels or inactive keys) to active keys
    const normalizeThemeToKey = (value?: string) => {
      const trimmed = (value || '').trim();
      if (!trimmed) return '';
      const match = themeOptions.find(
        (option) => option.storyThemeKey === trimmed || option.label === trimmed
      );
      return match?.storyThemeKey || '';
    };

    const normalizeStyleToKey = (value?: string) => {
      const trimmed = (value || '').trim();
      if (!trimmed) return '';
      const match = styleOptions.find(
        (option) => option.visualStyleKey === trimmed || option.label === trimmed
      );
      return match?.visualStyleKey || '';
    };

    const finalTheme = normalizeThemeToKey(userSettings?.theme) || defaultThemeValue;
    const finalStyle = normalizeStyleToKey(userSettings?.style) || defaultStyleValue;
    const finalImageModelKey = userSettings?.imageModelKey || defaultImageModelKey;
    
    if (finalTheme) setTheme(finalTheme);
    if (finalStyle) setStyle(finalStyle);
    if (finalImageModelKey) setImageModelKey(finalImageModelKey);
  }, [userSettings, defaultThemeValue, defaultStyleValue, defaultImageModelKey]);

  const selectedTheme = useMemo(
    () => themeOptions.find((option) => option.storyThemeKey === (theme || defaultThemeValue)) ?? null,
    [themeOptions, theme, defaultThemeValue]
  );
  const selectedStyle = useMemo(
    () => styleOptions.find((option) => option.visualStyleKey === (style || defaultStyleValue)) ?? null,
    [styleOptions, style, defaultStyleValue]
  );

  // A theme may force the story model; the picker then shows it locked.
  const storyChoice = useMemo(
    () =>
      resolveStoryModelChoice(
        storyModels,
        storyModelPick ?? userSettings?.llmModelKey,
        selectedTheme?.forcedLlmModelKey
      ),
    [storyModels, storyModelPick, userSettings?.llmModelKey, selectedTheme?.forcedLlmModelKey]
  );

  const themeSelectId = `${idPrefix}-theme-select`;
  const styleSelectId = `${idPrefix}-style-select`;
  const storyModelSelectId = `${idPrefix}-story-model-select`;

  const handleSavePreferences = () => {
    // Phase 3: Call PATCH /api/user/preferences to update values
    updateUserPreferencesMutation.mutate({
      theme: theme || undefined,
      style: style || undefined,
      imageModelKey: imageModelKey || undefined,
      // Only sent when the player actually chose one; a theme-forced model is not a preference.
      llmModelKey:
        storyModelPick !== null && !storyChoice.forced
          ? storyModelKeyToSave(storyModelPick, storyChoice.defaultKey)
          : undefined,
    }, {
      onSuccess: () => {
        // Phase 4: Navigate after successful save
        // 4a: If no game id, go to main menu
        if (!userGames || userGames.length === 0) {
          setLocation('/menu');
          return;
        }
        
        // 4: Get the most recent game (first in the list, ordered by updated_at DESC)
        const currentGameId = userGames[0]?.id;
        if (currentGameId) {
          setLocation(`/game/${currentGameId}`);
        } else {
          setLocation('/menu');
        }
      }
    });
  };

  const isCatalogLoading = loadingThemes || loadingStyles;
  const hasCatalogData = themeOptions.length > 0 && styleOptions.length > 0;
  const canSave = hasCatalogData && Boolean(imageModelKey) && imageModels.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>User Settings</DialogTitle>
          <DialogDescription>View and adjust your preferences</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {hasCatalogData ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={themeSelectId}>
                  Narrative Theme
                </label>
                <select
                  id={themeSelectId}
                  className="w-full bg-black/40 border px-2 py-2 rounded"
                  value={theme || defaultThemeValue}
                  onChange={(event) => setTheme(event.target.value)}
                >
                  {themeOptions.map((option) => {
                    const value = option.storyThemeKey;
                    return (
                      <option key={value} value={value}>
                        {option.label}
                      </option>
                    );
                  })}
                </select>
                {selectedTheme?.tags && (
                  <p className="text-xs text-muted-foreground">
                    {selectedTheme.tags}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={styleSelectId}>
                  Visual Style
                </label>
                <select
                  id={styleSelectId}
                  className="w-full bg-black/40 border px-2 py-2 rounded"
                  value={style || defaultStyleValue}
                  onChange={(event) => setStyle(event.target.value)}
                >
                  {styleOptions.map((option) => (
                    <option key={option.visualStyleKey} value={option.visualStyleKey}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {selectedStyle?.exemplifiedBy && (
                  <p className="text-xs text-muted-foreground">
                    {selectedStyle.exemplifiedBy}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {isCatalogLoading ? "Loading creative settings…" : "No creative settings available."}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Image Model</label>
              <span className="text-xs text-muted-foreground font-mono">
                {imageModelKey}
              </span>
            </div>
            {imageModels.length > 0 ? (
              <select
                className="w-full bg-black/40 border px-2 py-2 rounded"
                value={imageModelKey}
                onChange={(event) => setImageModelKey(event.target.value)}
              >
                {imageModels.map((model) => (
                  <option key={model.modelKey} value={model.modelKey}>
                    {model.displayName || model.modelKey}
                    {model.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-muted-foreground">
                Loading image models…
              </div>
            )}

            {storyChoice.showPicker && (
              <div className="space-y-2 pt-3">
                <label className="text-sm font-medium" htmlFor={storyModelSelectId}>
                  Story Model
                </label>
                <select
                  id={storyModelSelectId}
                  className="w-full bg-black/40 border px-2 py-2 rounded disabled:opacity-60 disabled:cursor-not-allowed"
                  value={storyChoice.selectedKey}
                  onChange={(event) => setStoryModelPick(event.target.value)}
                  disabled={storyChoice.forced !== null}
                  data-testid="select-story-model"
                >
                  {storyModels.map((model) => (
                    <option key={model.modelKey} value={model.modelKey}>
                      {storyModelLabel(model)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {storyChoice.forced
                    ? `Set by the ${selectedTheme?.label ?? "selected"} theme.`
                    : storyModels.find((model) => model.modelKey === storyChoice.selectedKey)?.description ??
                      "The AI that writes your story. Changes apply from your next turn."}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleSavePreferences}
                disabled={updateUserPreferencesMutation.isPending || !canSave}
              >
                {updateUserPreferencesMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default UserSettingsDialog;
