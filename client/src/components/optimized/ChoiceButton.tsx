import { memo } from 'react';

interface Choice {
  id: string;
  text: string;
  summary?: string;
  risk?: string;
}

interface ChoiceButtonProps {
  choice: Choice;
  onClick: () => void;
  index: number;
}

const ChoiceButton = memo(({ choice, onClick, index }: ChoiceButtonProps) => {
  return (
    <button
      onClick={onClick}
      className="w-full group relative overflow-hidden bg-gradient-to-r from-slate-800/80 to-slate-700/80 backdrop-blur-sm hover:from-purple-900/80 hover:to-indigo-900/80 text-left p-4 min-h-[44px] rounded-2xl border border-white/10 hover:border-purple-400/50 transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation"
      style={{
        animationDelay: `${index * 50}ms`
      }}
      data-testid={`choice-${choice.id}`}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-indigo-600 opacity-0 group-hover:opacity-10 transition-opacity duration-300"></div>
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex-1">
          <span className="text-white/90 group-hover:text-white transition-colors duration-300 text-sm md:text-base block">
            {choice.text}
          </span>
          {choice.summary && (
            <span className="text-white/60 text-xs block mt-1">{choice.summary}</span>
          )}
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/20 group-hover:bg-purple-500/40 flex items-center justify-center transition-all duration-300">
          <span className="text-lg group-hover:translate-x-1 transition-transform duration-300">→</span>
        </div>
      </div>
    </button>
  );
});

ChoiceButton.displayName = 'ChoiceButton';

export default ChoiceButton;

