import { useState, useEffect, useCallback } from 'react';
import type { GameState } from '@shared/schema';

/**
 * Hook for managing turn history navigation
 * Tracks turn numbers in a stack for back navigation
 */
export function useTurnHistory(gameState: GameState | undefined) {
  const [history, setHistory] = useState<number[]>([]);

  // Update history when turn changes
  useEffect(() => {
    if (!gameState?.turns.length) return;
    
    const currentTurnNumber = gameState.turns[gameState.turns.length - 1]?.turnNumber;
    if (currentTurnNumber === undefined) return;

    setHistory(prev => {
      // Only add if it's a new turn (not already at the end)
      if (prev.length === 0 || prev[prev.length - 1] !== currentTurnNumber) {
        return [...prev, currentTurnNumber];
      }
      return prev;
    });
  }, [gameState?.turns.length, gameState?.turns]);

  const goBack = useCallback(() => {
    if (history.length > 1) {
      setHistory(prev => prev.slice(0, -1));
      return history[history.length - 2]; // Return previous turn number
    }
    return null;
  }, [history]);

  const canGoBack = history.length > 1;

  return {
    history,
    currentTurnNumber: history[history.length - 1] ?? null,
    goBack,
    canGoBack,
  };
}

