import { memo } from 'react';
import NarrativeText from './NarrativeText';

interface NarrativeCardProps {
  narrative: string | null;
  loading: boolean;
  error: string | null;
  typewriterEnabled: boolean;
}

const NarrativeCard = memo(({ 
  narrative, 
  loading, 
  error,
  typewriterEnabled
}: NarrativeCardProps) => {
  return (
    <div className="relative backdrop-blur-xl bg-slate-900/40 border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl">
      {/* Glassmorphic shine effect */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>
      
      <div className="relative min-h-[120px] w-full max-w-full">
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-white/10 rounded w-full"></div>
            <div className="h-4 bg-white/10 rounded w-5/6"></div>
            <div className="h-4 bg-white/10 rounded w-4/6"></div>
          </div>
        ) : error ? (
          <div className="text-red-400">Error loading narrative</div>
        ) : narrative ? (
          <NarrativeText text={narrative} typewriterEnabled={typewriterEnabled} />
        ) : null}
      </div>
    </div>
  );
});

NarrativeCard.displayName = 'NarrativeCard';

export default NarrativeCard;

