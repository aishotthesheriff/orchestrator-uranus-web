import { useState, useCallback } from 'react';

interface AppLoadingStates {
  isLoadingAssets: boolean;
  isDetectingDevice: boolean;
  isLoadingGameData: boolean;
}

export function useAppLoading() {
  const [loadingStates, setLoadingStates] = useState<AppLoadingStates>({
    isLoadingAssets: true,
    isDetectingDevice: false,
    isLoadingGameData: false,
  });

  const setLoading = useCallback((key: keyof AppLoadingStates, value: boolean) => {
    setLoadingStates(prev => ({ ...prev, [key]: value }));
  }, []);

  const isAppLoading = Object.values(loadingStates).some(Boolean);

  return {
    ...loadingStates,
    setLoading,
    isAppLoading,
  };
}
