import CheckDisplay from './CheckDisplay';
import DeltaDisplay from './DeltaDisplay';
import ReactMarkdown from 'react-markdown';
import { Loader2, Image as ImageIcon } from 'lucide-react';
import { Button } from './ui/button';

interface Check {
  skill: string;
  dc: number;
  roll: number;
  success: boolean;
  description?: string;
}

interface DeltaChange {
  stat: string;
  change: number;
  note?: string;
}

interface TurnCardProps {
  turnNumber: number;
  narrative: string;
  checks?: Check[];
  delta: DeltaChange[];
  imageUrl?: string | null;
  imageTemplate?: string | null;
  imageStatus?: 'pending' | 'completed' | 'failed';
  imageJobId?: string;
  imagePrompt?: string | null;
  imageStyle?: string | null;
  showMissionViewscreen?: boolean;
  onVisualize?: () => void;
  isGeneratingImage?: boolean;
}

export default function TurnCard({ turnNumber, narrative, checks = [], delta, imageUrl, imageStatus, imageJobId, imagePrompt, imageStyle, showMissionViewscreen = false, onVisualize, isGeneratingImage = false }: TurnCardProps) {
  return (
    <div className="mb-6 p-4 border border-[#00ffff] bg-[#001a1a]" data-testid={`turn-${turnNumber}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="inline-block px-4 py-2 bg-[#00ffff] text-black text-lg font-bold" data-testid={`turn-badge-${turnNumber}`}>
          TURN {turnNumber}
        </div>
        {onVisualize && (
          <Button
            variant="outline"
            size="sm"
            onClick={onVisualize}
            disabled={isGeneratingImage}
            className="border-[#00aaaa] text-[#00aaaa]"
            data-testid="button-generate-image"
          >
            {isGeneratingImage ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                GENERATING...
              </>
            ) : (
              <>
                <ImageIcon className="w-4 h-4 mr-2" />
                VISUALIZE
              </>
            )}
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {/* Show skeleton loader while image is generating */}
        {imageStatus === 'pending' && !imageUrl && (
          <div className="relative w-full h-48 bg-muted animate-pulse border-2 border-[#ff66ff]" data-testid={`turn-image-loading-${turnNumber}`}>
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Generating scene...
              </span>
            </div>
          </div>
        )}
        
        {/* Show image when ready */}
        {imageUrl && (
          <div className="overflow-hidden border-2 border-[#ff66ff] flex justify-center" data-testid={`turn-image-${turnNumber}`}>
            <img
              src={imageUrl}
              alt={`Scene visualization for turn ${turnNumber}`}
              className="w-3/4 h-auto"
            />
          </div>
        )}
        {imagePrompt && (
          <div className="border border-[#ffaa00]/40 bg-black/40 p-3 text-xs text-[#ffddff]" data-testid={`image-prompt-${turnNumber}`}>
            <div className="text-[#ff66ff] font-semibold uppercase mb-1">[ IMAGE PROMPT ]</div>
            <p className="whitespace-pre-wrap leading-relaxed">{imagePrompt}</p>
            {imageStyle && (
              <div className="mt-2 text-[#ffaa00] uppercase tracking-wide text-[0.65rem]">Style: {imageStyle}</div>
            )}
          </div>
        )}
        <div className="text-base leading-relaxed prose prose-sm max-w-none prose-invert text-[#00ffff]" data-testid={`narrative-${turnNumber}`}>
          <ReactMarkdown>{narrative}</ReactMarkdown>
        </div>
        {checks.map((check, i) => (
          <CheckDisplay key={i} {...check} />
        ))}
        <DeltaDisplay changes={delta} />
      </div>
    </div>
  );
}
