import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GameState } from '@shared/schema';

/**
 * Hook for loading narrative text from current turn
 * Uses React Query cache from useGameLogic to avoid duplicate fetches
 */
export function useNarrative(turnNumber: number | null, gameId: string | null) {
  const { data: gameState } = useQuery<GameState>({
    queryKey: ['api', 'game', gameId],
    enabled: !!gameId && turnNumber !== null,
  });

  const narrative = useMemo(() => {
    if (!gameState || turnNumber === null) return null;
    const turn = gameState.turns.find(t => t.turnNumber === turnNumber);
    return turn?.narrative || null;
  }, [gameState, turnNumber]);

  const loading = !gameState && !!gameId;
  const error = null;

  return { narrative, loading, error };
}

/**
 * Hook for loading story image from current turn
 * Uses React Query cache from useGameLogic to avoid duplicate fetches
 */
export function useStoryImage(turnNumber: number | null, gameId: string | null) {
  const { data: gameState, isLoading, isFetching } = useQuery<GameState>({
    queryKey: ['api', 'game', gameId],
    enabled: !!gameId && turnNumber !== null,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const image = useMemo(() => {
    if (!gameState || turnNumber === null) return null;
    const turn = gameState.turns.find(t => t.turnNumber === turnNumber);
    const imageUrl = turn?.imageUrl || null;
    
    // Debug logging to track image updates
    if (imageUrl) {
      console.log('[useStoryImage] Image URL for turn', turnNumber, ':', imageUrl);
    }
    
    return imageUrl;
  }, [gameState, turnNumber]);

  // Loading is true if we don't have gameState yet, or if we're refetching and don't have an image
  const loading = (isLoading || (isFetching && !image)) && !!gameId;
  const error = null;

  return { image, loading, error };
}

/**
 * Hook for loading choices/actions from gameState
 * Uses React Query cache from useGameLogic to avoid duplicate fetches
 */
export function useChoices(gameId: string | null, isComplete: boolean) {
  const { data: gameState } = useQuery<GameState>({
    queryKey: ['api', 'game', gameId],
    enabled: !!gameId,
  });

  const choices = useMemo(() => {
    if (!gameState || isComplete) return [];
    return gameState.currentActions.map((action, i) => ({
      id: `choice-${i}`,
      text: action.action,
      summary: action.summary,
      risk: action.risk,
      usesItemId: action.usesItemId,
      next: action.action, // For compatibility
    }));
  }, [gameState?.currentActions, isComplete]);

  const loading = !gameState && !!gameId;
  const error = null;

  return { choices, loading, error };
}

