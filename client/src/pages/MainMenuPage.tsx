import { useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient, GAMES_LIST_QUERY_OPTIONS, gamesListKey } from '@/lib/queryClient';
import { Play, Trash2, Loader2, HelpCircle, Settings } from 'lucide-react';
import CRTBackground from '@/components/CRTBackground';
import { useToast } from '@/hooks/use-toast';
import type { GameState, GameSummary } from '@shared/schema';
import { UserSettingsDialog } from '@/components/UserSettingsDialog';

function SnowCrashVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Horizontal band structure (based on image description)
    const bands = [
      { y: 0, height: 0.20, colors: [[255, 0, 0], [255, 102, 255], [0, 255, 0], [0, 0, 255]] }, // Top: greens, reds, magentas
      { y: 0.20, height: 0.10, colors: [[0, 0, 200], [0, 100, 255], [0, 150, 255]] }, // Deep blue band
      { y: 0.30, height: 0.40, colors: [[0, 255, 0], [0, 255, 255], [100, 255, 100], [50, 200, 255]] }, // Mid: bright greens and cyans
      { y: 0.70, height: 0.05, colors: [[0, 255, 255], [100, 255, 255], [150, 255, 255]] }, // Cyan band
      { y: 0.75, height: 0.25, colors: [[0, 255, 0], [0, 255, 255], [100, 255, 100]] }, // Bottom: greens and blues
    ];

    let frameCount = 0;

    function draw() {
      if (!ctx || !canvas) return;
      
      frameCount++;
      
      // Create dense pixelated noise effect
      const pixelSize = 2;
      const cols = Math.ceil(canvas.width / pixelSize);
      const rows = Math.ceil(canvas.height / pixelSize);

      // Clear with very slight fade for trailing effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw dense pixelated noise with band structure
      for (let row = 0; row < rows; row++) {
        const y = row * pixelSize;
        const normalizedY = row / rows;
        
        // Find which band this row belongs to
        let currentBand = bands[0];
        for (const band of bands) {
          if (normalizedY >= band.y && normalizedY < band.y + band.height) {
            currentBand = band;
            break;
          }
        }
        
        for (let col = 0; col < cols; col++) {
          const x = col * pixelSize;
          
          // Random chance for black pixels throughout
          if (Math.random() < 0.15) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(x, y, pixelSize, pixelSize);
            continue;
          }
          
          // Determine color from band palette with some randomness
          const colorIndex = Math.floor(Math.random() * currentBand.colors.length);
          const baseColor = currentBand.colors[colorIndex];
          
          // Add variation and slight color shifting
          const variation = 0.7 + Math.random() * 0.6;
          const hueVariation = (frameCount * 0.3 + row * 0.05 + col * 0.02) % 360;
          
          const [r, g, b] = [
            Math.max(0, Math.min(255, baseColor[0] * variation + Math.sin(hueVariation * Math.PI / 180) * 20)),
            Math.max(0, Math.min(255, baseColor[1] * variation + Math.cos(hueVariation * Math.PI / 180) * 20)),
            Math.max(0, Math.min(255, baseColor[2] * variation + Math.sin((hueVariation + 120) * Math.PI / 180) * 20))
          ];
          
          // Vary opacity for more texture
          const opacity = 0.8 + Math.random() * 0.2;
          
          ctx.fillStyle = `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, ${opacity})`;
          ctx.fillRect(x, y, pixelSize, pixelSize);
        }
      }

      // Add horizontal scanline distortion
      for (let y = 0; y < canvas.height; y += 2) {
        if (Math.random() < 0.08) {
          ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + Math.random() * 0.15})`;
          ctx.fillRect(0, y, canvas.width, 1);
        }
      }

      requestAnimationFrame(draw);
    }

    draw();

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-50 pointer-events-none snow-crash-canvas"
      style={{ 
        mixBlendMode: 'screen',
        filter: 'contrast(1.2) brightness(1.1)'
      }}
    />
  );
}

export default function MainMenuPage() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState<string | null>(null);
  const [snowCrashActive, setSnowCrashActive] = useState(false);
  const [glitchIntensity, setGlitchIntensity] = useState<'low' | 'high' | 'extreme'>('low');
  const [showResetButton, setShowResetButton] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const storedUsername = localStorage.getItem('quest-to-uranus-username');
    if (!storedUsername) {
      setLocation('/');
      return;
    }
    setUsername(storedUsername);
  }, [setLocation]);

  const { data: userGames, refetch: refetchGames } = useQuery<GameSummary[]>({
    queryKey: gamesListKey(username),
    enabled: !!username,
    refetchInterval: false,
    ...GAMES_LIST_QUERY_OPTIONS,
  });

  const startGameMutation = useMutation({
    mutationFn: async () => {
      if (!username) throw new Error('No username set');
      const res = await apiRequest('POST', '/api/game/start', { username });
      const data = (await res.json()) as GameState;
      return data;
    },
    onSuccess: (data: GameState) => {
      // Verify intro turn is ready (has narrative and actions) before navigating
      const introTurn = data.turns.find(t => t.turnNumber === 0);
      const hasNarrative = introTurn?.narrative && introTurn.narrative.trim().length > 0;
      const hasActions = Array.isArray(data.currentActions) && data.currentActions.length > 0;
      
      if (!hasNarrative || !hasActions) {
        // Intro turn not ready yet - wait and poll
        setIsCheckingReadiness(true);
        toast({
          title: 'Initializing...',
          description: 'Generating your voyage narrative. Please wait...',
        });
        
        // Poll for ready state
        const checkReady = async () => {
          try {
            const res = await apiRequest('GET', `/api/game/${data.id}`);
            const gameState = (await res.json()) as GameState;
            const checkIntroTurn = gameState.turns.find(t => t.turnNumber === 0);
            const checkHasNarrative = checkIntroTurn?.narrative && checkIntroTurn.narrative.trim().length > 0;
            const checkHasActions = Array.isArray(gameState.currentActions) && gameState.currentActions.length > 0;
            
            if (checkHasNarrative && checkHasActions) {
              // Ready to navigate
              setIsCheckingReadiness(false);
              queryClient.setQueryData(['api', 'game', gameState.id], gameState);
              setLocation(`/game/${gameState.id}`);
            } else {
              // Not ready yet, check again in 500ms
              setTimeout(checkReady, 500);
            }
          } catch (error) {
            console.error('Error checking game readiness:', error);
            setIsCheckingReadiness(false);
            toast({
              title: 'Error',
              description: 'Failed to verify game initialization',
              variant: 'destructive',
            });
          }
        };
        
        // Start polling after a brief delay
        setTimeout(checkReady, 500);
        return;
      }
      
      // Intro turn is ready - navigate immediately
      queryClient.setQueryData(['api', 'game', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['api', 'games', 'user'] });
      setLocation(`/game/${data.id}`);
    },
    onError: () => {
      setIsCheckingReadiness(false);
      toast({
        title: 'Error',
        description: 'Failed to start game',
        variant: 'destructive',
      });
    },
  });

  const deleteGameMutation = useMutation({
    mutationFn: async (gameIdToDelete: string) => {
      await apiRequest('DELETE', `/api/game/${gameIdToDelete}`);
    },
    onSuccess: () => {
      refetchGames();
      toast({
        title: "Game Deleted",
        description: "Voyage has been scrubbed"
      });
    }
  });

  const handleChangeCaptain = () => {
    localStorage.removeItem('quest-to-uranus-username');
    setLocation('/');
  };

  const handleStartNewVoyage = () => {
    startGameMutation.mutate();
  };

  const handleResumeGame = (gameId: string) => {
    setLocation(`/game/${gameId}`);
  };

  const handleDangerClick = () => {
    // Start glitch takeover sequence
    setGlitchIntensity('high');
    setShowResetButton(false);
    
    setTimeout(() => {
      setGlitchIntensity('extreme');
    }, 1500);
    
    setTimeout(() => {
      setSnowCrashActive(true);
    }, 3000);
    
    setTimeout(() => {
      setShowResetButton(true);
    }, 5000);
  };

  const handleReset = () => {
    setSnowCrashActive(false);
    setGlitchIntensity('low');
    setShowResetButton(false);
  };

  if (!username) {
    return null;
  }

  return (
    <div className={`relative w-full min-h-screen overflow-auto bg-black font-mono text-[#00ffff] ${snowCrashActive ? 'snow-crash-active' : ''} ${glitchIntensity === 'extreme' ? 'glitch-extreme' : glitchIntensity === 'high' ? 'glitch-high' : ''}`}>
      <CRTBackground intensity={glitchIntensity === 'extreme' ? 'extreme' : glitchIntensity === 'high' ? 'high' : 'low'} />

      <div className={`relative z-10 container mx-auto px-4 py-8 max-w-4xl ${glitchIntensity !== 'low' ? 'glitch-foreground' : ''}`}>
        <div className="absolute top-4 right-4 sm:top-8 sm:right-8">
          <Link href="/help">
            <button
              className="p-2 sm:p-3 border-2 border-[#ffaa00] text-[#ffaa00] bg-[#001a0a] hover:bg-[#002a1a] hover:shadow-[0_0_20px_#ffaa00] transition-all"
              data-testid="button-help"
              title="How to Probe Uranus"
            >
              <HelpCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </Link>
        </div>
        
        <div className="text-center mb-8">
          <h1 className="md:text-5xl font-bold drop-shadow-[0_0_15px_#00ffff] mb-2 animate-[flicker_3s_infinite] text-[46px]">
            <span className="block">█▓ THERES MONEY IN URANUS ▓█</span>
            <span className="block">█▓ Ready to Occupy? {username} ▓█</span>
          </h1>
          <div className="text-[#ffaa00] text-sm">
            [ MISSION CONTROL INTERFACE ]
          </div>
        </div>

        <div className="space-y-6">
          <div className="border-2 border-[#00ffff] bg-[#001a1a] p-6 shadow-[0_0_20px_#00ffff]">
            <div className="space-y-6">
              <div>
              </div>

              <button
                onClick={handleStartNewVoyage}
                disabled={startGameMutation?.isPending || isCheckingReadiness}
                className="w-full px-8 py-4 border-2 border-[#00ffff] text-[#00ffff] bg-[#001a1a] hover:bg-[#002f2f] hover:shadow-[0_0_30px_#00ffff] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 font-bold text-lg tracking-wide animate-[pulseGlow_4s_infinite]"
                data-testid="button-new-game"
              >
                {(startGameMutation?.isPending || isCheckingReadiness) ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {isCheckingReadiness ? 'GENERATING NARRATIVE...' : 'INITIALIZING VOYAGE...'}
                  </span>
                ) : (
                  <span>▶ START NEW VOYAGE</span>
                )}
              </button>
            </div>
          </div>

          {userGames && userGames.length > 0 && (
            <div className="border-2 border-[#ffaa00] bg-[#1a1000] p-6 shadow-[0_0_20px_#ffaa00]">
              <div className="text-[#ffaa00] text-sm mb-4">[ SAVED VOYAGES ]</div>
              <div className="space-y-3">
                {userGames.map((game) => (
                  <div
                    key={game.id}
                    className="border border-[#ffaa00] bg-[#0a0a00] p-4 hover:bg-[#1a1000] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm text-[#ffaa00] font-bold">
                            Day {game.day} - {game.segment}
                          </span>
                          {game.isComplete && (
                            <span className="text-xs px-2 py-0.5 border border-[#ff66ff] text-[#ff66ff]">
                              {game.failureReason ? 'FAILED' : 'COMPLETE'}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#00aaaa]">
                          Turn {game.turnNumber}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResumeGame(game.id)}
                          className="px-4 py-2 border-2 border-[#00ffff] text-[#00ffff] bg-[#001a1a] hover:bg-[#002f2f] hover:shadow-[0_0_15px_#00ffff] transition-all font-bold flex items-center gap-1"
                          data-testid={`button-resume-${game.id}`}
                        >
                          <Play className="w-3 h-3" />
                          {game.isComplete ? 'VIEW' : 'RESUME'}
                        </button>
                        <button
                          onClick={() => deleteGameMutation.mutate(game.id)}
                          disabled={deleteGameMutation.isPending}
                          className="px-3 py-2 border border-[#ff0000] text-[#ff0000] bg-transparent hover:bg-[#1a0000] disabled:opacity-30 transition-all"
                          data-testid={`button-delete-${game.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {userGames && userGames.length === 0 && (
            <div className="border-2 border-[#00aaaa] bg-[#001a1a] p-6 text-center">
              <p className="text-[#00aaaa] text-sm">░▒▓ No saved voyages yet ▓▒░</p>
            </div>
          )}

          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleChangeCaptain}
                className="px-6 py-2 border border-[#00aaaa] text-[#00aaaa] bg-transparent hover:bg-[#001a1a] hover:border-[#00ffff] hover:text-[#00ffff] transition-all text-sm"
                data-testid="button-change-captain"
              >
                [ CHANGE CAPTAIN ]
              </button>
              <button
                onClick={() => setShowSettingsDialog(true)}
                className="px-6 py-2 border border-[#00aaaa] text-[#00aaaa] bg-transparent hover:bg-[#001a1a] hover:border-[#00ffff] hover:text-[#00ffff] transition-all text-sm flex items-center gap-2"
                data-testid="button-preferences"
                title="User Preferences"
              >
                <Settings className="w-4 h-4" />
                [ PREFERENCES ]
              </button>
            </div>
            <div>
              <button
                onClick={handleDangerClick}
                disabled={snowCrashActive || glitchIntensity !== 'low'}
                className="px-4 py-1.5 border border-[#ff0000] text-[#ff0000] bg-transparent hover:bg-[#1a0000] hover:border-[#ff4444] hover:text-[#ff4444] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs font-bold tracking-wider"
                data-testid="button-danger"
              >
                ⚠ DANGER ⚠
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-[#00aaaa] text-xs opacity-70">
          ░▒▓ ETH LOVES URANUS • MISSION CONTROL 2025-2069 ▓▒░
        </div>
      </div>

      {/* Snow Crash Overlay */}
      {snowCrashActive && <SnowCrashVisual />}

      {/* Reset Button */}
      {showResetButton && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <button
            onClick={handleReset}
            className="reset-button px-8 py-4 border-2 border-[#00ffff] text-[#00ffff] bg-black/80 backdrop-blur-sm hover:bg-black hover:shadow-[0_0_30px_#00ffff] transition-all font-bold text-xl tracking-wide pointer-events-auto"
            data-testid="button-reset"
          >
            [ RESET ]
          </button>
        </div>
      )}

      {/* User Settings Dialog */}
      <UserSettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
      />

      <style>{`
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 10px #00ffff; }
          50% { box-shadow: 0 0 35px #00ffff; }
        }
        @keyframes flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
          20%, 24%, 55% { opacity: 0.85; }
        }
        @keyframes flashWarning {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes dissolve {
          0% { 
            opacity: 1;
            filter: blur(0px);
          }
          50% { 
            opacity: 0.5;
            filter: blur(2px);
          }
          100% { 
            opacity: 0;
            filter: blur(8px);
          }
        }
        @keyframes glitchRGB {
          0% { 
            text-shadow: 2px 0 0 #ff0000, -2px 0 0 #00ffff;
          }
          20% { 
            text-shadow: -2px 0 0 #ff0000, 2px 0 0 #00ffff;
          }
          40% { 
            text-shadow: 2px 0 0 #ff0000, -2px 0 0 #00ffff;
          }
          60% { 
            text-shadow: -2px 0 0 #ff0000, 2px 0 0 #00ffff;
          }
          80% { 
            text-shadow: 2px 0 0 #ff0000, -2px 0 0 #00ffff;
          }
          100% { 
            text-shadow: -2px 0 0 #ff0000, 2px 0 0 #00ffff;
          }
        }
        .glitch-high {
          filter: hue-rotate(45deg) contrast(1.5) brightness(1.2);
        }
        .glitch-extreme {
          filter: hue-rotate(90deg) contrast(2) brightness(1.5);
        }
        .glitch-foreground {
          animation: dissolve 3s ease-in forwards;
        }
        .glitch-text {
          animation: glitchRGB 0.1s infinite;
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .reset-button {
          animation: fadeIn 1s ease-out forwards;
        }
        .snow-crash-active {
          overflow: hidden;
        }
        .snow-crash-active .glitch-extreme {
          filter: hue-rotate(180deg) contrast(3) brightness(2) saturate(2);
        }
      `}</style>
    </div>
  );
}
