import { useState } from 'react';

interface ActionChipProps {
  action: string;
  summary: string;
  risk: 'Safe' | 'Risky' | 'Wild';
  itemIcon?: string;
  onClick?: () => void;
}

export default function ActionChip({ action, summary, risk, itemIcon, onClick }: ActionChipProps) {
  const [isPressed, setIsPressed] = useState(false);

  const riskColors = {
    Safe: 'border-[#00ffaa] text-[#00ffaa]',
    Risky: 'border-[#ffaa00] text-[#ffaa00]',
    Wild: 'border-[#ff66ff] text-[#ff66ff]'
  };

  const riskBg = {
    Safe: 'bg-[#001a1a]',
    Risky: 'bg-[#1a1000]',
    Wild: 'bg-[#1a0a1a]'
  };

  return (
    <button
      className={`min-w-full sm:min-w-60 sm:max-w-72 p-3 sm:p-4 gap-2 sm:gap-3 flex flex-col items-start border-2 ${riskColors[risk]} ${riskBg[risk]} transition-all duration-200 hover:shadow-[0_0_15px_currentColor] active:shadow-[0_0_20px_currentColor] ${isPressed ? 'scale-95' : 'scale-100'}`}
      onClick={() => {
        setIsPressed(true);
        setTimeout(() => setIsPressed(false), 200);
        onClick?.();
        console.log(`Action triggered: ${action}`);
      }}
      data-testid={`action-${action.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start justify-between w-full gap-2">
        <span className="text-sm font-medium text-left flex-1" data-testid="action-text">
          {action}
        </span>
        {itemIcon && (
          <span className="text-lg sm:text-base flex-shrink-0" data-testid="action-item-icon">
            {itemIcon}
          </span>
        )}
      </div>
      <p className="text-xs text-[#00aaaa] text-left" data-testid="action-summary">
        {summary}
      </p>
      <span className={`text-xs font-bold px-2 py-1 border ${riskColors[risk]}`} data-testid="action-risk">
        {risk.toUpperCase()}
      </span>
    </button>
  );
}
