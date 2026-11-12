import { memo } from 'react';
import { Sparkles } from 'lucide-react';

interface ChoicesToggleButtonProps {
  onClick: () => void;
  choicesCount: number;
  isOpen: boolean;
}

const ChoicesToggleButton = memo(({ onClick, choicesCount, isOpen }: ChoicesToggleButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={`fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-50 w-16 h-16 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg shadow-purple-500/50 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 touch-manipulation ${
        isOpen ? 'rotate-45' : ''
      }`}
      aria-label={isOpen ? 'Close choices' : 'Show choices'}
      data-testid="choices-toggle-button"
    >
      {isOpen ? (
        <span className="text-3xl font-light text-white">×</span>
      ) : (
        <div className="relative">
          <Sparkles className="w-7 h-7 text-white" />
          {choicesCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-pink-500 rounded-full text-xs flex items-center justify-center text-white font-bold">
              {choicesCount}
            </span>
          )}
        </div>
      )}
    </button>
  );
});

ChoicesToggleButton.displayName = 'ChoicesToggleButton';

export default ChoicesToggleButton;

