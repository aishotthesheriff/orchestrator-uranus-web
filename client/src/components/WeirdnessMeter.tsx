interface WeirdnessMeterProps {
  value: number;
  max?: number;
}

export default function WeirdnessMeter({ value, max = 5 }: WeirdnessMeterProps) {
  return (
    <div className="space-y-2" data-testid="weirdness-meter">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-wide font-mono text-[#7de3ff]">
          Weirdness
        </span>
        <span className="text-lg font-bold tabular-nums font-mono text-purple-400" data-testid="weirdness-value">
          {value}/{max}
        </span>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-3 rounded-full transition-all duration-300 ${
              i < value
                ? 'bg-purple-600 animate-pulse'
                : 'bg-[#072a2a]'
            }`}
            data-testid={`weirdness-dot-${i}`}
          />
        ))}
      </div>
      {value >= max && (
        <p className="text-xs font-mono text-purple-400 animate-pulse" data-testid="weirdness-warning">
          ⚠️ Reality Auditors incoming!
        </p>
      )}
    </div>
  );
}
