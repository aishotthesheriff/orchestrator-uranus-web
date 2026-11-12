import { useState, useCallback } from 'react';

interface GameContentLoadingStates {
  isProcessingAction: boolean;
  isGeneratingImage: boolean;
  currentActionText: string | null;
}

export function useGameContentLoading() {
  const [loadingStates, setLoadingStates] = useState<GameContentLoadingStates>({
    isProcessingAction: false,
    isGeneratingImage: false,
    currentActionText: null,
  });

  const setLoading = useCallback((key: keyof GameContentLoadingStates, value: boolean | string | null) => {
    setLoadingStates(prev => ({ ...prev, [key]: value }));
  }, []);

  const isContentLoading = loadingStates.isProcessingAction || loadingStates.isGeneratingImage;

  return {
    ...loadingStates,
    setLoading,
    isContentLoading,
  };
}
