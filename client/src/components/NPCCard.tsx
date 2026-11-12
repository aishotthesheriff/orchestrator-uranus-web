import type { NPCStatus } from "@shared/schema";

interface NPCCardProps {
  name: string;
  role: string;
  affinity: number;
  status: NPCStatus;
  lastInteraction?: string;
}

export default function NPCCard({ name, role, affinity, status, lastInteraction }: NPCCardProps) {
  const affinityColor = affinity >= 2 ? 'text-[#00ffaa]' : affinity <= -2 ? 'text-[#ff6666]' : 'text-[#00aaaa]';
  
  const statusColors: Record<NPCStatus, string> = {
    Indifferent: 'bg-[#0a0a0a] text-[#00aaaa] border-[#00aaaa]',
    Warm: 'bg-[#051a12] text-[#00ffaa] border-[#00ffaa]',
    Friendly: 'bg-[#0b2a1f] text-[#33ffcc] border-[#33ffcc]',
    Cold: 'bg-[#0a0a1a] text-[#6699ff] border-[#6699ff]',
    Hostile: 'bg-[#1a0000] text-[#ff6666] border-[#ff6666]',
    Rivalry: 'bg-[#1a0000] text-[#ff6666] border-[#ff6666]',
    Crush: 'bg-[#1a0a1a] text-[#ff66ff] border-[#ff66ff]'
  };

  return (
    <div className="p-4 border border-[#ff66ff] bg-[#0a0a0a] space-y-3" data-testid={`npc-${name.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-[#ff66ff]" data-testid="npc-name">{name}</h3>
          <p className="text-xs text-[#00aaaa]" data-testid="npc-role">{role}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 border ${statusColors[status]}`} data-testid="npc-status">
          {status.toUpperCase()}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#00aaaa]">Affinity</span>
          <span className={`font-bold ${affinityColor}`} data-testid="npc-affinity">
            {affinity > 0 ? '+' : ''}{affinity}/3
          </span>
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 7 }).map((_, i) => {
            const position = i - 3;
            const isFilled = affinity > 0 ? position < affinity && position >= 0 : position >= affinity && position < 0;
            return (
              <div
                key={i}
                className={`flex-1 h-1.5 transition-all ${
                  isFilled
                    ? affinity > 0
                      ? 'bg-[#00ffaa]'
                      : 'bg-[#ff6666]'
                    : 'bg-[#333333]'
                }`}
                data-testid={`affinity-bar-${i}`}
              />
            );
          })}
        </div>
      </div>
      {lastInteraction && (
        <p className="text-xs text-[#00aaaa] italic" data-testid="npc-last-interaction">
          "{lastInteraction}"
        </p>
      )}
    </div>
  );
}
