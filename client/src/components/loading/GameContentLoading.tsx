import { Loader2 } from 'lucide-react';

interface GameContentLoadingProps {
  actionText?: string;
  type?: 'action' | 'image';
  className?: string;
}

export default function GameContentLoading({ 
  actionText, 
  type = 'action',
  className = ''
}: GameContentLoadingProps) {
  const message = type === 'action' ? 'PROCESSING ACTION...' : 'GENERATING IMAGE...';
  
  return (
    <div className={`mb-6 p-4 border-2 border-[#00ffff] bg-[#001a1a] animate-pulse shadow-[0_0_20px_#00ffff] ${className}`} data-testid="loading-indicator">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-[#00ffff]" />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-[#00ffff] font-bold">{message}</span>
          {actionText && (
            <span className="text-xs text-[#ffaa00] italic" data-testid="current-action-text">
              "{actionText}"
            </span>
          )}
          <span className="text-xs text-[#00aaaa]">
            {type === 'action' ? 'Processing action...' : 'Generating scene...'}
          </span>
        </div>
      </div>
    </div>
  );
}
