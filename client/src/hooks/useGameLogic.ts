import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient, REFERENCE_DATA_QUERY_OPTIONS } from '@/lib/queryClient';
import { useLocation, useParams } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import type { GameState } from '@shared/schema';
import { useUserSettings, useUpdateUserSettings } from '@/hooks/useUserSettings';

interface Item {
  id: string;
  name: string;
  description: string;
  icon: string;
  skillBonus: any | null;
  sceneEffect: any | null;
  tags: string | null;
  active: number;
}

import type { ModStoryTheme, ModVisualStyle } from "@/pages/devtools/types";

export function useGameLogic() {
  const params = useParams();
  const gameId = params.gameId || null;
  const [, setLocation] = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [customAction, setCustomAction] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imagePromptUsed, setImagePromptUsed] = useState<string | null>(null);
  const [showPreviousTurns, setShowPreviousTurns] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [absurdity, setAbsurdity] = useState<number>(2);

  // Redirect to menu if no gameId
  useEffect(() => {
    if (!gameId) {
      setLocation('/menu');
    }
  }, [gameId, setLocation]);

  // Fetch items from API
  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['api', 'reference', 'items'],
  });

  // Fetch themes and styles from mod table endpoints - using actual types now
  const { data: themesData = [] } = useQuery<ModStoryTheme[]>({
    queryKey: ['api', 'reference', 'story-themes'],
    ...REFERENCE_DATA_QUERY_OPTIONS,
  });

  const { data: stylesData = [] } = useQuery<ModVisualStyle[]>({
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

  // Parse defaults from system-defaults
  const defaults = useMemo(() => {
    if (systemDefaultsData?.story_theme_key || systemDefaultsData?.visual_style_key) {
      return {
        theme: systemDefaultsData.story_theme_key?.trim() || '',
        style: systemDefaultsData.visual_style_key?.trim() || '',
      };
    }
    
    return { theme: '', style: '' };
  }, [systemDefaultsData]);

  // Use mod table data directly - no transformation needed
  // Fetch game state
  const { data: gameState, isLoading } = useQuery<GameState>({
    queryKey: ['api', 'game', gameId],
    enabled: !!gameId,
    refetchInterval: false
  });

  // Check if intro turn is ready (has narrative and actions)
  const isIntroReady = useMemo(() => {
    if (!gameState) return false;
    
    // Must have at least one turn (intro turn is turnNumber 0)
    if (gameState.turns.length === 0) return false;
    
    const introTurn = gameState.turns.find(t => t.turnNumber === 0);
    if (!introTurn) return false;
    
    // Intro turn must have narrative
    if (!introTurn.narrative || introTurn.narrative.trim().length === 0) return false;
    
    // Must have actions ready
    if (!Array.isArray(gameState.currentActions) || gameState.currentActions.length === 0) return false;
    
    return true;
  }, [gameState]);

  // Get username from gameState or localStorage
  const username = gameState?.username || (typeof window !== 'undefined' ? localStorage.getItem('quest-to-uranus-username') : null);

  // Fetch user settings using the dedicated hook
  const { data: userPreferences } = useUserSettings();

  // Extract preference values with defaults
  const themeOptions = themesData;
  const styleOptions = stylesData;

  const defaultThemeValue = useMemo(() => {
    if (!defaults.theme) return '';
    const match = themeOptions.find(
      (option) =>
        option.storyThemeKey === defaults.theme ||
        option.label === defaults.theme
    );
    return match?.storyThemeKey ?? '';
  }, [defaults.theme, themeOptions]);

  const defaultStyleValue = useMemo(() => {
    if (!defaults.style) return '';
    const match = styleOptions.find(
      (option) =>
        option.visualStyleKey === defaults.style ||
        option.label === defaults.style
    );
    return match?.visualStyleKey ?? '';
  }, [defaults.style, styleOptions]);

  const theme = useMemo(() => {
    if (userPreferences?.theme) {
      return userPreferences.theme;
    }
    return defaultThemeValue;
  }, [userPreferences?.theme, defaultThemeValue]);

  const style = useMemo(() => {
    if (userPreferences?.style) {
      return userPreferences.style;
    }
    return defaultStyleValue;
  }, [userPreferences?.style, defaultStyleValue]);

  const imageModelKey = userPreferences?.imageModelKey || null;

  useEffect(() => {
    if (typeof gameState?.absurdity === 'number') {
      setAbsurdity(gameState.absurdity);
    }
  }, [gameState?.absurdity]);

  // Take action mutation (sends action to server, triggers narrative generation)
  const actionMutation = useMutation({
    mutationFn: async ({ action, customText }: { action: string; customText?: string }) => {
      const response = await apiRequest('POST', '/api/game/action', {
        gameId,
        action,
        customText
      });
      return await response.json();
    },
    onSuccess: (data: any) => {
      // Expect { turnJobId, status: 'processing' }
      if (data?.status === 'processing') {
        toast({
          title: "Processing Turn",
          description: "Stand by for results...",
        });
      } else if (data && (data as any).id) {
        // Backward compatibility if server returned full state
        queryClient.setQueryData(['api', 'game', gameId], data as GameState);
        // Don't clear currentActionText - let it persist
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to process action",
        variant: "destructive"
      });
      // Keep currentActionText so loading indicator stays visible
      // Don't clear currentActionText on error
    }
  });

  const generateImageMutation = useMutation({
    mutationFn: async ({ gameId: gId, turnNumber }: { gameId: string; turnNumber?: number }) => {
      const response = await apiRequest('POST', '/api/generate-image', {
        gameId: gId,
        turnNumber
      });
      return await response.json();
    },
    onSuccess: (data: { imageUrl: string; promptUsed: string }) => {
      setGeneratedImage(data.imageUrl);
      setImagePromptUsed(data.promptUsed);
      toast({
        title: "Image Generated",
        description: "Scene has been visualized"
      });
    },
    onError: () => {
      toast({
        title: "Image Generation Failed",
        description: "Unable to generate image. Please try again.",
        variant: "destructive"
      });
    }
  });

  const updateEquipmentMutation = useMutation<
    GameState,
    Error,
    string[],
    { previousState?: GameState }
  >({
    mutationFn: async (nextItems: string[]) => {
      if (!gameId) {
        throw new Error('No game selected');
      }
      const response = await apiRequest(
        'PATCH',
        `/api/games/${gameId}/equipped-items`,
        { equippedItems: nextItems }
      );
      return (await response.json()) as GameState;
    },
    onMutate: async (nextItems) => {
      if (!gameId) {
        return {};
      }

      await queryClient.cancelQueries({ queryKey: ['api', 'game', gameId] });
      const previousState = queryClient.getQueryData<GameState>(['api', 'game', gameId]);

      if (previousState) {
        queryClient.setQueryData(['api', 'game', gameId], {
          ...previousState,
          equippedItems: nextItems
        });
      }

      return { previousState };
    },
    onError: (error, _nextItems, context) => {
      if (context?.previousState && gameId) {
        queryClient.setQueryData(['api', 'game', gameId], context.previousState);
      }
      toast({
        title: "Failed to update equipment",
        description: error.message || "Unable to save equipment loadout.",
        variant: "destructive"
      });
    },
    onSuccess: (updatedState) => {
      if (!gameId) {
        return;
      }
      queryClient.setQueryData(['api', 'game', gameId], updatedState);
    },
    onSettled: () => {
      if (gameId) {
        queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
      }
    }
  });

  // User preferences mutation - uses the dedicated hook which handles cache invalidation
  const updateUserPreferencesMutation = useUpdateUserSettings();

  // Game settings mutation (absurdity only)
  const updateGameSettingsMutation = useMutation<
    GameState,
    Error,
    { absurdity?: number }
  >({
    mutationFn: async (payload) => {
      if (!gameId) {
        throw new Error('No game selected');
      }
      const response = await apiRequest('PATCH', `/api/games/${gameId}/settings`, payload);
      return (await response.json()) as GameState;
    },
    onSuccess: (updatedState) => {
      if (gameId) {
        queryClient.setQueryData(['api', 'game', gameId], updatedState);
      }
      if (typeof updatedState.absurdity === 'number') {
        setAbsurdity(updatedState.absurdity);
      }
      toast({
        title: "Settings saved",
        description: "Game settings updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update settings",
        description: error.message || "Unable to save settings.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      if (gameId) {
        queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
      }
    },
  });


  // WebSocket connection for image and turn updates
  useEffect(() => {
    if (!gameId) return;
    
    const socket = connectSocket();
    
    // Join game room
    socket.emit('joinGame', gameId);
    
    // Listen for narrative ready (turn complete means narrative is ready, not everything done)
    socket.on('turnComplete', (data: { gameId: string; turnNumber: number }) => {
      queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
      toast({
        title: "Next Turn Ready",
        description: `Turn ${data.turnNumber} narrative is ready`,
      });
    });
    
    // Listen for image ready
    socket.on('imageReady', (data: {
      jobId: string;
      gameId: string;
      turnNumber: number;
      imageUrl: string;
      imageTemplate: string;
    }) => {
      console.log('[WebSocket] Image ready event received:', {
        jobId: data.jobId,
        gameId: data.gameId,
        turnNumber: data.turnNumber,
        imageUrl: data.imageUrl,
        imageTemplate: data.imageTemplate,
        expectedGameId: gameId
      });
      
      // Verify this event is for our game
      if (data.gameId !== gameId) {
        console.warn('[WebSocket] imageReady event gameId mismatch:', {
          received: data.gameId,
          expected: gameId
        });
        return;
      }
      
      // Force refetch to get new image - use refetchQueries for immediate refetch
      console.log('[WebSocket] Invalidating and refetching game state query');
      queryClient.refetchQueries({ 
        queryKey: ['api', 'game', gameId],
        type: 'active'
      });
      
      // Also invalidate to mark as stale
      queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
      
      // Show success toast
      toast({
        title: "Scene Visualized",
        description: `Turn ${data.turnNumber} image is ready`,
      });
      
      console.log('[WebSocket] Image ready handler completed');
    });
    
    // Listen for image failures
    socket.on('imageFailed', (data: {
      jobId: string;
      gameId: string;
      turnNumber: number;
      error: string;
    }) => {
      console.error('[WebSocket] Image generation failed event received:', {
        jobId: data.jobId,
        gameId: data.gameId,
        turnNumber: data.turnNumber,
        error: data.error,
        expectedGameId: gameId
      });
      
      // Verify this event is for our game
      if (data.gameId !== gameId) {
        console.warn('[WebSocket] imageFailed event gameId mismatch:', {
          received: data.gameId,
          expected: gameId
        });
        return;
      }
      
      // Show error with retry option
      toast({
        title: "Image Generation Failed",
        description: data.error,
        variant: "destructive",
      });
    });
    
    // Cleanup
    return () => {
      socket.emit('leaveGame', gameId);
      socket.off('turnComplete');
      socket.off('imageReady');
      socket.off('imageFailed');
    };
  }, [gameId, toast]);

  const handleActionClick = (action: string, isMobile: boolean) => {
    if (!gameId || actionMutation.isPending) return;
    
    // All immediate UI state changes
    setShowPreviousTurns(false);
    setCustomAction('');
    setShowCustomInput(false);
    setGeneratedImage(null);
    setImagePromptUsed(null);
    
    actionMutation.mutate({ action });
  };

  const handleCustomAction = (isMobile: boolean) => {
    if (!gameId || !customAction.trim() || actionMutation.isPending) return;
    
    // All immediate UI state changes
    setShowPreviousTurns(false);
    setCustomAction('');
    setShowCustomInput(false);
    setGeneratedImage(null);
    setImagePromptUsed(null);
    
    actionMutation.mutate({ action: customAction, customText: customAction });
  };

  const handleBackToMenu = () => {
    setLocation('/menu');
  };

  const toggleItem = async (itemId: string) => {
    if (!gameState || !gameId || updateEquipmentMutation.isPending) return;

    const equipped = gameState.equippedItems;
    const isEquipped = equipped.includes(itemId);
    let nextEquipped: string[];

    if (isEquipped) {
      nextEquipped = equipped.filter(id => id !== itemId);
    } else if (equipped.length < 3) {
      nextEquipped = [...equipped, itemId];
    } else {
      toast({
        title: "Maximum Items Equipped",
        description: "You can only equip 3 items at once.",
        variant: "destructive"
      });
      return;
    }

    await updateEquipmentMutation.mutateAsync(nextEquipped);
  };

  const itemIcon = (itemId: string) => {
    return items.find((i: Item) => i.id === itemId)?.icon || '';
  };

  return {
    // State
    gameState,
    items,
    isLoading,
    isIntroReady,
    gameId,
    showSettings,
    setShowSettings,
    showHelp,
    setShowHelp,
    customAction,
    setCustomAction,
    showCustomInput,
    setShowCustomInput,
    generatedImage,
    imagePromptUsed,
    showPreviousTurns,
    setShowPreviousTurns,
    scrollRef,
    imageModelKey,
    absurdity,
    setAbsurdity,
    theme,
    style,
    
    // Mutations
    actionMutation,
    generateImageMutation,
    updateGameSettingsMutation,
    updateUserPreferencesMutation,
    
    // Handlers
    handleActionClick,
    handleCustomAction,
    handleBackToMenu,
    toggleItem,
    itemIcon
  };
}
