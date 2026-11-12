interface StatBarProps {
  label: string;
  value: number;
  max: number;
  icon: string;
  color?: string;
  dailyConsumption?: number;
}

export default function StatBar({ label, value, max, icon, color = "bg-primary", dailyConsumption }: StatBarProps) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  const isLow = percentage < 30;
  const isCritical = percentage < 15;

  return (
    <div className="space-y-2" data-testid={`stat-${label.toLowerCase()}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base" data-testid={`icon-${label.toLowerCase()}`}>{icon}</span>
          <span className="text-sm font-medium uppercase tracking-wide font-mono text-[#7de3ff]">
            {label}
          </span>
          {dailyConsumption !== undefined && dailyConsumption > 0 && (
            <span className="text-xs text-[#57b8c6] font-mono" data-testid={`consumption-${label.toLowerCase()}`}>
              -{dailyConsumption}/day
            </span>
          )}
        </div>
        <span className={`text-lg font-bold tabular-nums font-mono ${isCritical ? 'text-red-500' : isLow ? 'text-yellow-400' : 'text-[#c6f3ff]'}`} data-testid={`value-${label.toLowerCase()}`}>
          {value}/{max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#072a2a] overflow-hidden" data-testid={`bar-${label.toLowerCase()}`}>
        <div
          className={`h-full transition-all duration-300 rounded-full ${isCritical ? 'bg-red-600' : isLow ? 'bg-yellow-500' : color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
