import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import CRTBackground from '@/components/CRTBackground';
import VideoSplashScreen from '@/components/VideoSplashScreen';
import { apiRequest, REFERENCE_DATA_QUERY_OPTIONS } from '@/lib/queryClient';
import type { ModStoryTheme, ModVisualStyle } from '@/pages/devtools/types';
import {
  resolveStoryModelChoice,
  storyModelKeyToSave,
  storyModelLabel,
  useStoryModels,
} from '@/hooks/useStoryModels';

interface PreferenceSetupProps {
  username: string;
  onComplete: () => void;
  onSkip: () => void;
}

interface ImageModelOption {
  modelKey: string;
  displayName: string;
  isDefault: boolean;
  sortOrder: number;
}

interface RawImageModel {
  modelKey: string;
  displayName?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
}

function PreferenceSetup({ username, onComplete, onSkip }: PreferenceSetupProps) {
  const [theme, setTheme] = useState('');
  const [style, setStyle] = useState('');
  const [imageModelKey, setImageModelKey] = useState('');
  // Story model the player picked on this screen; null until they touch the control.
  const [storyModelPick, setStoryModelPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: themesData = [], isLoading: loadingThemes } = useQuery<ModStoryTheme[]>({
    queryKey: ['api', 'reference', 'story-themes'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  const { data: stylesData = [], isLoading: loadingStyles } = useQuery<ModVisualStyle[]>({
    queryKey: ['api', 'reference', 'visual-styles'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  // Fetch defaults from system-defaults endpoint (new approach)
  const { data: systemDefaultsData } = useQuery<{ 
    image_model_key?: string; 
    visual_style_key?: string; 
    story_theme_key?: string;
  }>({
    queryKey: ['api', 'reference', 'system-defaults'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  const { data: imageModelsRaw = [], isLoading: loadingImageModels } = useQuery<RawImageModel[]>({
    queryKey: ['api', 'reference', 'image-models'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  const { data: existingPreferences, isLoading: loadingPreferences } = useQuery<{
    theme?: string;
    style?: string;
    imageModelKey?: string;
    llmModelKey?: string;
  }>({
    queryKey: ['api', 'user', 'preferences', { username }],
    enabled: !!username,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/user/preferences?username=${encodeURIComponent(username)}`);
      if (!response.ok) {
        throw new Error('Failed to load existing preferences');
      }
      return await response.json();
    },
  });

  const { data: storyModels = [] } = useStoryModels();
  const selectedThemeOption = themesData.find((option) => option.storyThemeKey === theme);
  // A theme may force the story model; the picker then shows it locked.
  const storyChoice = useMemo(
    () =>
      resolveStoryModelChoice(
        storyModels,
        storyModelPick ?? existingPreferences?.llmModelKey,
        selectedThemeOption?.forcedLlmModelKey
      ),
    [storyModels, storyModelPick, existingPreferences?.llmModelKey, selectedThemeOption?.forcedLlmModelKey]
  );

  const imageModels: ImageModelOption[] = useMemo(() => {
    return imageModelsRaw
      .map((model) => ({
        modelKey: model.modelKey,
        displayName: model.displayName || model.modelKey,
        isDefault: model.isDefault ?? false,
        sortOrder: model.sortOrder ?? 0,
      }))
      .filter((model) => model.modelKey)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.modelKey.localeCompare(b.modelKey);
      });
  }, [imageModelsRaw]);

  // Parse defaults from system-defaults
  const parsedDefaults = useMemo(() => {
    if (systemDefaultsData?.story_theme_key || systemDefaultsData?.visual_style_key) {
      return {
        theme: systemDefaultsData.story_theme_key?.trim() || '',
        style: systemDefaultsData.visual_style_key?.trim() || '',
      };
    }
    
    return { theme: '', style: '' };
  }, [systemDefaultsData]);

  const defaultThemeValue = useMemo(() => {
    if (!parsedDefaults.theme) return '';
    const match = themesData.find(
      (themeOption) =>
        themeOption.storyThemeKey === parsedDefaults.theme ||
        themeOption.label === parsedDefaults.theme
    );
    return match?.storyThemeKey ?? '';
  }, [parsedDefaults.theme, themesData]);

  const defaultStyleValue = useMemo(() => {
    if (!parsedDefaults.style) return '';
    const match = stylesData.find(
      (styleOption) =>
        styleOption.visualStyleKey === parsedDefaults.style ||
        styleOption.label === parsedDefaults.style
    );
    return match?.visualStyleKey ?? '';
  }, [parsedDefaults.style, stylesData]);

  const defaultImageModelKey = useMemo(() => {
    if (systemDefaultsData?.image_model_key) {
      return systemDefaultsData.image_model_key;
    }
    return '';
  }, [systemDefaultsData?.image_model_key]);

  useEffect(() => {
    const existingTheme = existingPreferences?.theme;
    const existingStyle = existingPreferences?.style;
    const existingImageModelKey = existingPreferences?.imageModelKey;

    // Normalize any saved label/key to current active keys
    const normalizeThemeToKey = (value?: string) => {
      const trimmed = (value || '').trim();
      if (!trimmed) return '';
      const match = themesData.find(
        (option) => option.storyThemeKey === trimmed || option.label === trimmed
      );
      return match?.storyThemeKey || '';
    };

    const normalizeStyleToKey = (value?: string) => {
      const trimmed = (value || '').trim();
      if (!trimmed) return '';
      const match = stylesData.find(
        (option) => option.visualStyleKey === trimmed || option.label === trimmed
      );
      return match?.visualStyleKey || '';
    };

    setTheme(normalizeThemeToKey(existingTheme) || defaultThemeValue || '');
    setStyle(normalizeStyleToKey(existingStyle) || defaultStyleValue || '');
    setImageModelKey(existingImageModelKey || defaultImageModelKey || '');
  }, [
    existingPreferences?.theme,
    existingPreferences?.style,
    existingPreferences?.imageModelKey,
    defaultThemeValue,
    defaultStyleValue,
    defaultImageModelKey,
  ]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const response = await apiRequest('PATCH', '/api/user/preferences', {
        username,
        theme: theme || undefined,
        style: style || undefined,
        imageModelKey: imageModelKey || undefined,
        // Only sent when the player actually chose one; a theme-forced model is not a preference.
        llmModelKey:
          storyModelPick !== null && !storyChoice.forced
            ? storyModelKeyToSave(storyModelPick, storyChoice.defaultKey)
            : undefined,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Failed to save preferences');
      }

      onComplete();
    } catch (err) {
      console.error('Failed to save preferences', err);
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const loading =
    loadingThemes || loadingStyles || loadingPreferences || loadingImageModels;

  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-black font-mono text-[#00ffff]">
      <CRTBackground />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12 text-center">
        <div className="max-w-xl w-full border-2 border-[#00ffff] bg-[#001a1a] p-8 shadow-[0_0_30px_#00ffff] space-y-6">
          <div>
            <h2 className="text-3xl font-bold text-[#00ffff] drop-shadow-[0_0_15px_#00ffff] mb-2">
              Configure Your Voyage
            </h2>
            <p className="text-sm text-[#ffaa00]">
              Commander {username}, choose your narrative vibe before launch.
            </p>
          </div>

          {loading ? (
            <div className="text-[#ffaa00] text-sm">Loading mission parameters…</div>
          ) : (
            <div className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#ffaa00]">
                  Narrative Theme
                </label>
                <select
                  value={theme}
                  onChange={(event) => setTheme(event.target.value)}
                  className="w-full px-3 py-2 bg-[#001a1a] border border-[#00ffff] text-[#00ffff] focus:outline-none focus:ring-2 focus:ring-[#00ffff]"
                >
                  {themesData.map((option) => (
                    <option key={option.storyThemeKey} value={option.storyThemeKey}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {theme && (
                  <p className="text-xs text-[#00aaaa]">
                    {themesData.find((option) => option.storyThemeKey === theme)?.tags}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#ffaa00]">
                  Visual Style
                </label>
                <select
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                  className="w-full px-3 py-2 bg-[#001a1a] border border-[#00ffff] text-[#00ffff] focus:outline-none focus:ring-2 focus:ring-[#00ffff]"
                >
                  {stylesData.map((option) => (
                    <option key={option.visualStyleKey} value={option.visualStyleKey}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {style && (
                  <p className="text-xs text-[#00aaaa]">
                    {stylesData.find((option) => option.visualStyleKey === style)?.exemplifiedBy}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#ffaa00]">
                  Image Model
                </label>
                <select
                  value={imageModelKey}
                  onChange={(event) => setImageModelKey(event.target.value)}
                  className="w-full px-3 py-2 bg-[#001a1a] border border-[#00ffff] text-[#00ffff] focus:outline-none focus:ring-2 focus:ring-[#00ffff]"
                >
                  {imageModels.map((model) => (
                    <option key={model.modelKey} value={model.modelKey}>
                      {model.displayName || model.modelKey}
                      {model.isDefault ? ' (Default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {storyChoice.showPicker && (
                <div className="space-y-2">
                  <label htmlFor="welcome-story-model" className="block text-sm font-semibold text-[#ffaa00]">
                    Story Model
                  </label>
                  <select
                    id="welcome-story-model"
                    value={storyChoice.selectedKey}
                    onChange={(event) => setStoryModelPick(event.target.value)}
                    disabled={storyChoice.forced !== null}
                    data-testid="select-story-model"
                    className="w-full px-3 py-2 bg-[#001a1a] border border-[#00ffff] text-[#00ffff] focus:outline-none focus:ring-2 focus:ring-[#00ffff] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {storyModels.map((model) => (
                      <option key={model.modelKey} value={model.modelKey}>
                        {storyModelLabel(model)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-[#00aaaa]">
                    {storyChoice.forced
                      ? `Set by the ${selectedThemeOption?.label ?? 'selected'} theme.`
                      : storyModels.find((model) => model.modelKey === storyChoice.selectedKey)?.description ??
                        'The AI that writes your story.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {error ? (
            <div className="text-sm text-[#ffaa00]">
              ⚠ {error}
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
            <button
              onClick={onSkip}
              className="w-full sm:w-auto px-6 py-2 border-2 border-[#00ffff] text-[#00ffff] hover:bg-[#002f2f] transition-all"
            >
              Skip for Now
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving || !imageModelKey}
              className="w-full sm:w-auto px-6 py-2 border-2 border-[#ffaa00] text-[#ffaa00] bg-[#001a1a] hover:bg-[#332000] hover:shadow-[0_0_20px_#ffaa00] disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold"
            >
              {saving ? 'Saving…' : 'Save & Launch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SearchUser {
  id: string;
  username: string;
}

export default function WelcomePage() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [usernameInput, setUsernameInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showVideoSplash, setShowVideoSplash] = useState(false);
  const [booting, setBooting] = useState(true);
  const [showPreferences, setShowPreferences] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);

  useEffect(() => {
    setTimeout(() => setBooting(false), 3000);
  }, []);

  // Search for existing users
  const { data: searchResults = [], isLoading: searching } = useQuery<SearchUser[]>({
    queryKey: ['api', 'user', 'search', { pattern: searchQuery }],
    enabled: mode === 'existing' && searchQuery.trim().length >= 2,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/user/search?pattern=${encodeURIComponent(searchQuery.trim())}`);
      if (!response.ok) {
        throw new Error('Failed to search users');
      }
      return await response.json();
    },
  });

  const handleUsernameSubmit = async () => {
    if (mode === 'new') {
      if (!usernameInput.trim()) return;
      if (submitting) return;

      const trimmedUsername = usernameInput.trim();

      try {
        setSubmitting(true);
        setError(null);
        
        // Step 1: Create user record in DB and establish browser session
        const response = await apiRequest('PUT', '/api/user', {
          username: trimmedUsername,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? 'Failed to initialize commander profile');
        }

        // User record created and session established successfully
        localStorage.setItem('quest-to-uranus-username', trimmedUsername);
        setCurrentUsername(trimmedUsername);
        
        // Step 2: Navigate to user settings (preferences)
        // User record is guaranteed to exist in DB at this point (response.ok passed)
        setShowPreferences(true);
      } catch (err) {
        console.error('Failed to create user', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize commander profile');
      } finally {
        setSubmitting(false);
      }
    } else {
      // Existing user mode - authenticate selected user
      if (!selectedUser) return;
      if (submitting) return;

      try {
        setSubmitting(true);
        setError(null);
        
        // Step 1: Create user record in DB and establish browser session
        const response = await apiRequest('PUT', '/api/user', {
          username: selectedUser.username,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? 'Failed to authenticate');
        }

        // User record created and session established successfully
        localStorage.setItem('quest-to-uranus-username', selectedUser.username);
        setCurrentUsername(selectedUser.username);
        
        // Step 2: Navigate to user settings (preferences)
        // User record is guaranteed to exist in DB at this point (response.ok passed)
        setShowPreferences(true);
      } catch (err) {
        console.error('Failed to authenticate user', err);
        setError(err instanceof Error ? err.message : 'Failed to authenticate');
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleUserSelect = useCallback((user: SearchUser) => {
    setSelectedUser(user);
    setSearchQuery(''); // Clear search after selection
  }, []);

  const handlePreferencesComplete = () => {
    setShowPreferences(false);
    setShowVideoSplash(true);
  };

  const handleSkipPreferences = () => {
    setShowPreferences(false);
    setShowVideoSplash(true);
  };

  const handleVideoSplashComplete = () => {
    setLocation('/menu');
  };

  if (showVideoSplash) {
    return <VideoSplashScreen onComplete={handleVideoSplashComplete} />;
  }

  if (showPreferences && currentUsername) {
    return (
      <PreferenceSetup
        username={currentUsername}
        onComplete={handlePreferencesComplete}
        onSkip={handleSkipPreferences}
      />
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-mono text-[#00ffff]">
      <CRTBackground />

      <div
        className={`absolute inset-0 bg-black transition-opacity ${
          booting ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transitionDuration: '3000ms' }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center select-none px-4">
        <h1 className="text-5xl md:text-6xl font-bold drop-shadow-[0_0_15px_#00ffff] mb-4 animate-[flicker_3s_infinite]">
          █▓▒ QUEST 4 URANUS ▒▓█
        </h1>
        
        <div className="text-[#ffaa00] mb-8 text-lg">
          [ SYSTEM INITIALIZING ]
        </div>

        <div className="w-full max-w-md space-y-4">
          {/* Mode Toggle */}
          <div className="flex gap-2 mb-4 justify-center">
            <button
              onClick={() => {
                setMode('new');
                setUsernameInput('');
                setSearchQuery('');
                setSelectedUser(null);
                setError(null);
              }}
              className={`px-4 py-2 border-2 transition-all ${
                mode === 'new'
                  ? 'border-[#00ffff] bg-[#002f2f] text-[#00ffff]'
                  : 'border-[#004444] text-[#008888] hover:border-[#00aaaa]'
              }`}
            >
              NEW USER
            </button>
            <button
              onClick={() => {
                setMode('existing');
                setUsernameInput('');
                setSearchQuery('');
                setSelectedUser(null);
                setError(null);
              }}
              className={`px-4 py-2 border-2 transition-all ${
                mode === 'existing'
                  ? 'border-[#00ffff] bg-[#002f2f] text-[#00ffff]'
                  : 'border-[#004444] text-[#008888] hover:border-[#00aaaa]'
              }`}
            >
              EXISTING USER
            </button>
          </div>

          {mode === 'new' ? (
            <>
              <div className="text-[#00ffff] text-left mb-2">
                &gt; ENTER YOUR COMMANDER CODENAME:
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUsernameSubmit()}
                  disabled={submitting}
                  className="w-full px-4 py-3 bg-[#001a1a] border-2 border-[#00ffff] text-[#00ffff] font-mono text-xl focus:outline-none focus:shadow-[0_0_30px_#00ffff] transition-all"
                  placeholder="TYPE NAME HERE..."
                  autoFocus
                  data-testid="input-username"
                />
              </div>

              {error ? (
                <div className="text-[#ffaa00] text-sm text-left">
                  ⚠ {error}
                </div>
              ) : null}

              <button
                onClick={handleUsernameSubmit}
                disabled={!usernameInput.trim() || submitting}
                className="w-full px-8 py-3 border-2 border-[#00ffff] text-[#00ffff] bg-[#001a1a] hover:bg-[#002f2f] hover:shadow-[0_0_30px_#00ffff] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 ease-in-out font-bold tracking-wide animate-[pulseGlow_4s_infinite]"
                data-testid="button-submit-username"
              >
                {submitting ? 'INITIALIZING…' : '▶ INITIALIZE PROBES'}
              </button>
            </>
          ) : (
            <>
              <div className="text-[#00ffff] text-left mb-2">
                &gt; SEARCH FOR EXISTING COMMANDER:
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedUser(null);
                  }}
                  disabled={submitting}
                  className="w-full px-4 py-3 bg-[#001a1a] border-2 border-[#00ffff] text-[#00ffff] font-mono text-xl focus:outline-none focus:shadow-[0_0_30px_#00ffff] transition-all"
                  placeholder="TYPE TO SEARCH..."
                  autoFocus
                  data-testid="input-search-user"
                />
                {searching && searchQuery.trim().length >= 2 && (
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-[#00aaaa] text-sm">
                    SEARCHING...
                  </div>
                )}
              </div>

              {/* Search Results */}
              {searchQuery.trim().length >= 2 && (
                <div className="max-h-48 overflow-y-auto border-2 border-[#004444] bg-[#001a1a]">
                  {searching ? (
                    <div className="p-4 text-[#00aaaa] text-sm text-center">
                      SEARCHING DATABASE...
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="space-y-1 p-2">
                      {searchResults.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => handleUserSelect(user)}
                          className={`w-full text-left px-4 py-2 border transition-all ${
                            selectedUser?.id === user.id
                              ? 'border-[#00ffff] bg-[#002f2f] text-[#00ffff]'
                              : 'border-[#004444] text-[#00aaaa] hover:border-[#00aaaa] hover:bg-[#002222]'
                          }`}
                        >
                          ▶ {user.username}
                          {selectedUser?.id === user.id && ' ✓'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-[#008888] text-sm text-center">
                      NO COMMANDERS FOUND
                    </div>
                  )}
                </div>
              )}

              {selectedUser && (
                <div className="text-[#00ffff] text-sm">
                  SELECTED: <span className="text-[#ffaa00]">{selectedUser.username}</span>
                </div>
              )}

              {error ? (
                <div className="text-[#ffaa00] text-sm text-left">
                  ⚠ {error}
                </div>
              ) : null}

              <button
                onClick={handleUsernameSubmit}
                disabled={!selectedUser || submitting}
                className="w-full px-8 py-3 border-2 border-[#00ffff] text-[#00ffff] bg-[#001a1a] hover:bg-[#002f2f] hover:shadow-[0_0_30px_#00ffff] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 ease-in-out font-bold tracking-wide animate-[pulseGlow_4s_infinite]"
                data-testid="button-select-user"
              >
                {submitting ? 'AUTHENTICATING…' : '▶ SELECT COMMANDER'}
              </button>
            </>
          )}
        </div>

        <div className="mt-8 text-[#ffaa00] text-sm">
          ░▒▓ AUTHORIZATION REQUIRED ▓▒░
        </div>

        <div className="absolute bottom-4 w-full text-center text-[#00aaaa] text-xs opacity-70 animate-[scroll_20s_linear_infinite] whitespace-nowrap">
          ░▒▓ ETH LOVES URANUS • CLASSIFIED MISSION 2025-2069 ▓▒░
        </div>
      </div>

      <style>{`
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 10px #00ffff; }
          50% { box-shadow: 0 0 35px #00ffff; }
        }
        @keyframes flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
          20%, 24%, 55% { opacity: 0.85; }
        }
        @keyframes scroll {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
