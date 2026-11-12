import React from 'react';

interface CompactStatProps {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  max: number;
  label: string;
}

export default function CompactStat({ icon: Icon, value, max, label }: CompactStatProps) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  const isCritical = percentage < 15;
  const isLow = percentage < 30;

  return (
    <div className="flex flex-col items-center gap-1 min-w-0" data-testid={`compact-stat-${label.toLowerCase()}`}>
      <Icon className={`w-4 h-4 ${isCritical ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-[#00ffff]'}`} data-testid={`compact-icon-${label.toLowerCase()}`} />
      <span className="text-[10px] font-mono text-[#00aaaa] uppercase tracking-tight" data-testid={`compact-label-${label.toLowerCase()}`}>
        {label}
      </span>
      <div className="w-full h-1.5 rounded-full bg-[#001a1a] overflow-hidden border border-[#00aaaa]">
        <div
          className={`h-full transition-all duration-300 ${isCritical ? 'bg-red-600' : isLow ? 'bg-yellow-600' : 'bg-cyan-600'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-bold tabular-nums ${isCritical ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-[#00ffff]'}`} data-testid={`compact-value-${label.toLowerCase()}`}>
        {value}
      </span>
    </div>
  );
}
