import { useState, useEffect } from 'react';
import { Settings, Send, RotateCcw, Loader2, Code2, Image as ImageIcon, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { Link } from 'wouter';
import StatBar from '@/components/StatBar';
import WeirdnessMeter from '@/components/WeirdnessMeter';
import TurnCard from '@/components/TurnCard';
import ActionChip from '@/components/ActionChip';
import NPCCard from '@/components/NPCCard';
import ItemCard from '@/components/ItemCard';
import CRTBackground from '@/components/CRTBackground';
import { HelpDialog } from '@/components/GameDialogs';
import UserSettingsDialog from '@/components/UserSettingsDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGameLogic } from '@/hooks/useGameLogic';
import { useGameContentLoading } from '@/hooks/useGameContentLoading';
import { useAppLoading } from '@/hooks/useAppLoading';
import GameDataLoading from '@/components/loading/GameDataLoading';
import GameContentLoading from '@/components/loading/GameContentLoading';

// Runtime path so build does not require the file; gradient fallback when image is missing
const SPACE_BG_STYLE = {
  backgroundImage:
    'linear-gradient(to bottom, #0a0010 0%, #000 50%, #050010 100%), url(/generated_images/cosmic_space_background_ada85e22.png)',
};

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

export default function DesktopGamePage() {
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
    theme,
    style,
    updateGameSettingsMutation,
    actionMutation,
    generateImageMutation,
    handleActionClick: originalHandleActionClick,
    handleCustomAction: originalHandleCustomAction,
    handleBackToMenu,
    toggleItem,
    itemIcon
  } = useGameLogic();

  const { isProcessingAction, currentActionText, setLoading: setContentLoading } = useGameContentLoading();
  const { setLoading: setAppLoading } = useAppLoading();

  // Clear content loading when turn completes
  useEffect(() => {
    if (gameState?.turns.length && !isLoading) {
      setContentLoading('isProcessingAction', false);
      setContentLoading('currentActionText', null);
    }
  }, [gameState?.turns.length, isLoading, setContentLoading]);

  // Clear image generation loading when mutation completes
  useEffect(() => {
    if (!generateImageMutation.isPending && generateImageMutation.isSuccess) {
      setContentLoading('isGeneratingImage', false);
    }
    if (!generateImageMutation.isPending && generateImageMutation.isError) {
      setContentLoading('isGeneratingImage', false);
    }
  }, [generateImageMutation.isPending, generateImageMutation.isSuccess, generateImageMutation.isError, setContentLoading]);


  // Local scroll handlers for desktop
  const handleActionClick = (action: string) => {
    // Set content loading state
    setContentLoading('currentActionText', action);
    setContentLoading('isProcessingAction', true);
    
    // Scroll to top immediately
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    
    // Also scroll to top after a short delay to ensure it sticks
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    }, 100);
    
    // Call the original handler
    originalHandleActionClick(action, false);
  };

  const handleCustomAction = () => {
    // Set content loading state
    setContentLoading('currentActionText', customAction);
    setContentLoading('isProcessingAction', true);
    
    // Scroll to top immediately
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    
    // Also scroll to top after a short delay to ensure it sticks
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    }, 100);
    
    // Call the original handler
    originalHandleCustomAction(false);
  };

  // Loading state - wait for intro turn to be ready
  if (!gameId || isLoading || !gameState || !isIntroReady) {
    return <GameDataLoading />;
  }

  return (
    <div className="relative min-h-screen bg-black font-mono text-[#00ffff]">
      <CRTBackground intensity="low" />
      
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed opacity-20"
        style={SPACE_BG_STYLE}
      />

      <div className="relative z-10 min-h-screen">
        <header className="sticky top-0 z-50 border-b-2 border-[#00ffff] bg-black/90 backdrop-blur-md shadow-[0_0_20px_#00ffff]">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-row items-center gap-4 min-w-0">
                <h1 className="text-2xl font-bold text-[#00ffff] drop-shadow-[0_0_10px_#00ffff] truncate" data-testid="game-title">
                  █ QUEST 4 URANUS █
                </h1>
                <div className="text-sm text-[#ffaa00] whitespace-nowrap" data-testid="game-meta">
                  DAY {gameState.day} • {gameState.segment.toUpperCase()}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('view');
                    window.location.href = url.toString();
                  }}
                  className="border-[#00ffff] text-[#00ffff]"
                  data-testid="button-toggle-view"
                  title="Switch to Compact View"
                >
                  COMPACT
                </Button>
                <Link href="/dev-tools">
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-[#00aaaa] text-[#00aaaa]"
                    data-testid="button-dev-tools"
                  >
                    <Code2 className="w-5 h-5" />
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowHelp(true)}
                  className="border-[#ffaa00] text-[#ffaa00] hover:bg-[#1a1000] hover:shadow-[0_0_20px_#ffaa00] transition-all"
                  data-testid="button-help"
                  title="How to Probe Uranus"
                >
                  <HelpCircle className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBackToMenu}
                  className="border-[#00ffff] text-[#00ffff]"
                  data-testid="button-back-to-menu"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  MENU
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSettings(true)}
                  className="border-[#00aaaa] text-[#00aaaa]"
                  data-testid="button-settings"
                >
                  <Settings className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            <aside className="order-2 lg:order-1 space-y-6">
              {/* Stats Panel */}
              <div className="p-6 border-2 border-[#00ffff] bg-[#001a1a] shadow-[0_0_20px_#00ffff] space-y-4" data-testid="stats-panel">
                <h2 className="text-lg font-bold text-[#ffaa00]">[ SHIP STATUS ]</h2>
                <StatBar label="Hull" value={gameState.stats.hull} max={100} icon="🚀" color="bg-blue-600" />
                <StatBar label="Oxygen" value={gameState.stats.oxygen} max={100} icon="💨" color="bg-cyan-600" dailyConsumption={3} />
                <StatBar label="Fuel" value={gameState.stats.fuel} max={100} icon="⛽" color="bg-amber-600" dailyConsumption={4} />
                <StatBar label="Food" value={gameState.stats.food} max={100} icon="🍔" color="bg-green-600" dailyConsumption={3} />
                <StatBar label="Morale" value={gameState.stats.morale} max={100} icon="❤️" color="bg-pink-600" dailyConsumption={2} />
                <div className="pt-2">
                  <WeirdnessMeter value={gameState.stats.weirdness} />
                </div>
              </div>

              {/* Crew Panel */}
              <div className="p-6 border-2 border-[#ff66ff] bg-[#1a0a1a] shadow-[0_0_20px_#ff66ff] space-y-4" data-testid="crew-panel">
                <h2 className="text-lg font-bold text-[#ffaa00]">[ CREW ]</h2>
                <div className="space-y-3">
                  {gameState.npcs.map(npc => (
                    <NPCCard
                      key={npc.id}
                      name={npc.name}
                      role={npc.role}
                      affinity={npc.affinity}
                      status={npc.status}
                      lastInteraction={npc.lastInteraction}
                    />
                  ))}
                </div>
              </div>

              {/* Items Panel */}
              <div className="p-6 border-2 border-[#ffaa00] bg-[#1a1000] shadow-[0_0_20px_#ffaa00] space-y-4" data-testid="items-panel">
                <h2 className="text-lg font-bold text-[#ffaa00]">
                  [ ITEMS ({gameState.equippedItems.length}/3) ]
                </h2>
                <div className="space-y-2">
                  {items.map((item: Item) => (
                    <ItemCard
                      key={item.id}
                      name={item.name}
                      description={item.description}
                      icon={item.icon}
                      equipped={gameState.equippedItems.includes(item.id)}
                      onToggle={() => toggleItem(item.id)}
                    />
                  ))}
                </div>
              </div>
            </aside>

            <main className="order-1 lg:order-2 space-y-6">
              {/* Desktop narrative feed with flexible height */}
              <div
                ref={scrollRef}
                className="p-6 border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_15px_#00ffff] overflow-y-auto min-h-[600px]"
                data-testid="narrative-feed"
              >
                {/* Loading indicator - always show when processing */}
                {isProcessingAction && currentActionText && (
                  <GameContentLoading 
                    actionText={currentActionText} 
                    type="action" 
                  />
                )}

                {(() => {
                  const last = gameState.turns[gameState.turns.length - 1];
                  const hasNarrative = typeof last?.narrative === 'string' && last.narrative.trim().length > 0;
                  return !hasNarrative;
                })() ? (
                  <GameContentLoading actionText={'Preparing your intro…'} type="action" />
                ) : (
                  <>
                    {/* Current Turn Section */}
                    <div className="mb-6">
                      <div className="mb-4 pb-2 border-b-2 border-[#ffaa00]">
                        <h2 className="text-2xl font-bold text-[#ffaa00] text-center">[ MISSION VIEWSCREEN ]</h2>
                      </div>
                      
                      <TurnCard
                        key={gameState.turns[gameState.turns.length - 1].turnNumber}
                        {...gameState.turns[gameState.turns.length - 1]}
                        imageUrl={generatedImage || gameState.turns[gameState.turns.length - 1].imageUrl}
                        imageTemplate={
                          generatedImage
                            ? `Manual: ${imagePromptUsed || 'Unknown'}`
                            : gameState.turns[gameState.turns.length - 1].imageTemplate
                        }
                        showMissionViewscreen={true}
                        onVisualize={() => {
                          setContentLoading('isGeneratingImage', true);
                          generateImageMutation.mutate({
                            gameId: gameId!,
                            turnNumber: gameState.turns[gameState.turns.length - 1]?.turnNumber
                          });
                        }}
                        isGeneratingImage={generateImageMutation.isPending}
                      />
                    </div>

                    {/* Previous Turns Section */}
                    {gameState.turns.length > 1 && (
                      <div>
                        <div className="mb-4 pb-2 border-b-2 border-[#00aaaa] flex items-center justify-between">
                          <h3 className="text-lg font-bold text-[#00aaaa]">[ PREVIOUS TRANSMISSIONS ]</h3>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowPreviousTurns(!showPreviousTurns)}
                            className="text-[#00aaaa] hover:text-[#00ffff]"
                            data-testid="button-toggle-previous-turns"
                          >
                            {showPreviousTurns ? (
                              <>
                                <ChevronUp className="w-4 h-4 mr-1" />
                                HIDE ({gameState.turns.length - 1})
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-4 h-4 mr-1" />
                                SHOW ({gameState.turns.length - 1})
                              </>
                            )}
                          </Button>
                        </div>
                        {showPreviousTurns && (
                          <div data-testid="previous-turns-section">
                            {gameState.turns.slice(0, -1).reverse().map((turn) => (
                              <TurnCard
                                key={turn.turnNumber}
                                {...turn}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Desktop actions */}
              {!gameState.isComplete && (
                <div className="p-4 border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_15px_#00ffff]" data-testid="actions-panel">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-[#ffaa00]">[ ACTIONS ]</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomInput(!showCustomInput)}
                      className="border-[#00aaaa] text-[#00aaaa] text-xs"
                      data-testid="button-custom-action"
                    >
                      {showCustomInput ? 'SUGGESTIONS' : 'CUSTOM'}
                    </Button>
                  </div>

                  {showCustomInput ? (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Describe your action..."
                        value={customAction}
                        onChange={(e) => setCustomAction(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCustomAction()}
                        disabled={actionMutation.isPending}
                        className="border-[#00ffff] bg-[#001a1a] text-[#00ffff] placeholder:text-[#006666]"
                        data-testid="input-custom-action"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleCustomAction()}
                        disabled={actionMutation.isPending || !customAction.trim()}
                        className="border-[#00ffff] text-[#00ffff] flex-shrink-0"
                        data-testid="button-submit-custom"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3" data-testid="action-chips">
                      {gameState.currentActions.map((action, i) => (
                        <ActionChip
                          key={i}
                          {...action}
                          itemIcon={action.usesItemId ? itemIcon(action.usesItemId) : undefined}
                          onClick={() => handleActionClick(action.action)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {gameState.isComplete && (
                <div className="p-6 border-2 border-[#ff66ff] bg-[#1a0a1a] shadow-[0_0_20px_#ff66ff] text-center" data-testid="game-complete">
                  <h2 className="text-2xl font-bold text-[#ff66ff] mb-2">
                    {gameState.failureReason ? '[ MISSION FAILED ]' : '[ MISSION COMPLETE! ]'}
                  </h2>
                  <p className="text-[#00aaaa] mb-4">
                    {gameState.failureReason || 'You successfully reached Uranus!'}
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleBackToMenu}
                    className="border-2 border-[#00ffff] text-[#00ffff]"
                    data-testid="button-new-voyage"
                  >
                    RETURN TO MENU
                  </Button>
                </div>
              )}
            </main>
          </div>
        </div>

        {/* Desktop Settings Dialog */}
        <UserSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          idPrefix="desktop"
        />

        {/* Shared Help Dialog */}
        <HelpDialog open={showHelp} onOpenChange={setShowHelp} />
      </div>
    </div>
  );
}
