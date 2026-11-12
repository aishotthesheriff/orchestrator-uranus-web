import { useState, useCallback, useMemo } from 'react';
import { BookOpen, ArrowLeft, RotateCcw, Settings, HelpCircle } from 'lucide-react';
import { useGameLogic } from '@/hooks/useGameLogic';
import { useNarrative, useStoryImage, useChoices } from '@/hooks/useOptimizedGameContent';
import { useTurnHistory } from '@/hooks/useTurnHistory';
import { useUserSettings } from '@/hooks/useUserSettings';
import BackgroundImage from '@/components/optimized/BackgroundImage';
import NarrativeCard from '@/components/optimized/NarrativeCard';
import ChoicesDrawer from '@/components/optimized/ChoicesDrawer';
import ChoicesToggleButton from '@/components/optimized/ChoicesToggleButton';
import ImageToggleButton from '@/components/optimized/ImageToggleButton';
import StatsPanel from '@/components/optimized/StatsPanel';
import EquipmentPanel from '@/components/optimized/EquipmentPanel';
import GameCompleteScreen from '@/components/optimized/GameCompleteScreen';
import { HelpDialog } from '@/components/GameDialogs';
import UserSettingsDialog from '@/components/UserSettingsDialog';
import GameDataLoading from '@/components/loading/GameDataLoading';

export default function OptimizedGamePage() {
  const {
    gameState,
    items,
    isLoading,
    isIntroReady,
    gameId,
    showSettings,
    setShowSettings,
    showHelp,
    setShowHelp,
    handleActionClick,
    handleBackToMenu,
    toggleItem,
  } = useGameLogic();

  const [choicesOpen, setChoicesOpen] = useState(false);
  const [imageVisible, setImageVisible] = useState(false);
  const { data: userPreferences } = useUserSettings();
  
  // Get typewriter preference, default to true
  const typewriterEnabled = useMemo(() => {
    return userPreferences?.typewriterEnabled ?? true;
  }, [userPreferences?.typewriterEnabled]);

  // Get current turn number
  const currentTurnNumber = useMemo(() => {
    if (!gameState?.turns.length) return null;
    return gameState.turns[gameState.turns.length - 1]?.turnNumber ?? null;
  }, [gameState?.turns]);

  // Turn history for back navigation
  const { history, goBack, canGoBack } = useTurnHistory(gameState);

  // Load all parts asynchronously in parallel
  const { narrative, loading: narrativeLoading, error: narrativeError } = useNarrative(currentTurnNumber, gameId);
  const { image, loading: imageLoading, error: imageError } = useStoryImage(currentTurnNumber, gameId);
  const { choices, loading: choicesLoading, error: choicesError } = useChoices(gameId, gameState?.isComplete ?? false);

  const handleChoice = useCallback((choice: { id: string; text: string }) => {
    if (!gameId) return;
    handleActionClick(choice.text, false);
    setChoicesOpen(false);
  }, [gameId, handleActionClick]);

  const handleBack = useCallback(() => {
    const previousTurnNumber = goBack();
    if (previousTurnNumber !== null) {
      // Note: This would need to navigate to that turn
      // For now, we'll just update the history
      // Full implementation would require turn navigation support
    }
  }, [goBack]);

  const handleRestart = useCallback(() => {
    // Would need to implement restart logic
    // For now, just navigate to menu
    handleBackToMenu();
  }, [handleBackToMenu]);

  // Loading state
  if (!gameId || isLoading || !gameState || !isIntroReady) {
    return <GameDataLoading />;
  }

  // Game complete state - replace entire view
  if (gameState.isComplete) {
    return (
      <GameCompleteScreen
        failureReason={gameState.failureReason ?? null}
        onBackToMenu={handleBackToMenu}
      />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Background Image Layer */}
      <div className={`absolute inset-0 ${imageVisible ? 'z-[35]' : 'z-0'}`}>
        <BackgroundImage image={image} loading={imageLoading} imageVisible={imageVisible} />
        {imageError && (
          <div className="absolute inset-0 bg-slate-900 flex items-center justify-center">
            <div className="text-red-400">Error loading image</div>
          </div>
        )}
      </div>

      {/* Header - Fixed at top, outside content layer */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between p-4 backdrop-blur-md bg-slate-900/30 border-b border-white/5">
        <div className="flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-purple-400" />
          <div className="flex flex-col">
            <h1 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              QUEST 4 URANUS
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              Step {history.length} • Day {gameState.day} • {gameState.segment.toUpperCase()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {canGoBack && (
            <button
              onClick={handleBack}
              className="w-11 h-11 sm:w-10 sm:h-10 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
              title="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
          )}
          <button
            onClick={handleRestart}
            className="w-11 h-11 sm:w-10 sm:h-10 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
            title="Restart"
            data-testid="button-restart"
          >
            <RotateCcw className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="w-11 h-11 sm:w-10 sm:h-10 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
            title="Help"
            data-testid="button-help"
          >
            <HelpCircle className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-11 h-11 sm:w-10 sm:h-10 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
            title="Settings"
            data-testid="button-settings"
          >
            <Settings className="w-5 h-5 text-white" />
          </button>
        </div>
      </header>

      {/* Content Layer - Positioned below header */}
      <div className="absolute inset-0 pt-[80px]">
        {/* Main Content - Narrative Card */}
        <div className="h-full p-4">
          <div className="w-full max-w-2xl mx-auto h-full overflow-y-auto flex items-start pt-4 pb-32 sm:pb-40">
            <NarrativeCard
              narrative={narrative}
              loading={narrativeLoading}
              error={narrativeError}
              typewriterEnabled={typewriterEnabled}
            />
          </div>
        </div>
      </div>

      {/* Image Toggle Button */}
      <ImageToggleButton
        isVisible={imageVisible}
        onClick={() => setImageVisible(!imageVisible)}
        hasImage={!!image}
      />

      {/* Floating Action Button */}
      {!choicesLoading && choices.length > 0 && (
        <ChoicesToggleButton
          onClick={() => setChoicesOpen(!choicesOpen)}
          choicesCount={choices.length}
          isOpen={choicesOpen}
        />
      )}

      {/* Choices Drawer */}
      <ChoicesDrawer
        choices={choices}
        loading={choicesLoading}
        error={choicesError}
        onChoiceClick={handleChoice}
        isOpen={choicesOpen}
        onClose={() => setChoicesOpen(false)}
      />

      {/* Stats Panel */}
      {gameState.stats && (
        <StatsPanel stats={gameState.stats} />
      )}

      {/* Equipment Panel */}
      {items.length > 0 && (
        <EquipmentPanel
          items={items}
          equippedItems={gameState.equippedItems}
          onToggleItem={toggleItem}
        />
      )}

      {/* Settings Dialog */}
      <UserSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        idPrefix="optimized"
      />

      {/* Help Dialog */}
      <HelpDialog open={showHelp} onOpenChange={setShowHelp} />
    </div>
  );
}

