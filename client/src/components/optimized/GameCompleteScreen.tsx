import { memo } from 'react';
import { Sparkles, RotateCcw } from 'lucide-react';

interface GameCompleteScreenProps {
  failureReason: string | null;
  onBackToMenu: () => void;
}

const GameCompleteScreen = memo(({ failureReason, onBackToMenu }: GameCompleteScreenProps) => {
  const isSuccess = !failureReason;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-xl bg-slate-900/95">
      <div className="relative backdrop-blur-xl bg-slate-900/40 border border-white/10 rounded-3xl p-8 md:p-12 shadow-2xl max-w-2xl mx-4">
        {/* Glassmorphic shine effect */}
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>
        
        <div className="relative text-center">
          <div className="mb-6">
            {isSuccess ? (
              <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-white font-semibold text-xl mb-4">
                <Sparkles className="w-6 h-6" />
                MISSION COMPLETE!
              </div>
            ) : (
              <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 rounded-full text-white font-semibold text-xl mb-4">
                MISSION FAILED
              </div>
            )}
          </div>

          <p className="text-lg text-white/90 mb-8">
            {isSuccess 
              ? 'You successfully reached Uranus!' 
              : failureReason}
          </p>

          <button
            onClick={onBackToMenu}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-full text-white font-semibold hover:from-purple-700 hover:to-indigo-700 transition-all duration-300 transform hover:scale-105 active:scale-95"
            data-testid="button-back-to-menu"
          >
            <RotateCcw className="w-5 h-5" />
            RETURN TO MENU
          </button>
        </div>
      </div>
    </div>
  );
});

GameCompleteScreen.displayName = 'GameCompleteScreen';

export default GameCompleteScreen;

