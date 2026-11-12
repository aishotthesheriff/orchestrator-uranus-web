import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import ChoiceButton from './ChoiceButton';

interface Choice {
  id: string;
  text: string;
  summary?: string;
  risk?: string;
}

interface ChoicesDrawerProps {
  choices: Choice[];
  loading: boolean;
  error: string | null;
  onChoiceClick: (choice: Choice) => void;
  isOpen: boolean;
  onClose: () => void;
}

const ChoicesDrawer = memo(({ 
  choices, 
  loading, 
  error, 
  onChoiceClick, 
  isOpen, 
  onClose 
}: ChoicesDrawerProps) => {
  const isEnding = !loading && choices.length === 0;

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 z-40 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      ></div>

      {/* Drawer */}
      <div 
        className={`fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-slate-900 via-slate-900/95 to-slate-900/90 backdrop-blur-xl border-t border-white/10 rounded-t-3xl transition-transform duration-300 ease-out max-h-[70vh] overflow-y-auto ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        data-testid="choices-drawer"
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-white/20 rounded-full"></div>
        </div>

        <div className="p-4 sm:p-6 pb-20 sm:pb-24">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div 
                  key={i} 
                  className="h-16 bg-white/5 rounded-2xl animate-pulse"
                  style={{ animationDelay: `${i * 100}ms` }}
                ></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-red-400 text-center p-4">Error loading choices</div>
          ) : isEnding ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-white font-semibold mb-4">
                <Sparkles className="w-5 h-5" />
                The End
              </div>
              <p className="text-slate-300 mb-6">Your journey has concluded...</p>
            </div>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                What do you do?
              </h3>
              <div className="space-y-3">
                {choices.map((choice, index) => (
                  <ChoiceButton
                    key={choice.id}
                    choice={choice}
                    onClick={() => {
                      onChoiceClick(choice);
                      onClose();
                    }}
                    index={index}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
});

ChoicesDrawer.displayName = 'ChoicesDrawer';

export default ChoicesDrawer;

