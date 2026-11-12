interface DeltaChange {
  stat: string;
  change: number;
  note?: string;
}

interface DeltaDisplayProps {
  changes: DeltaChange[];
}

export default function DeltaDisplay({ changes }: DeltaDisplayProps) {
  return (
    <div className="text-sm text-[#00aaaa] mt-3 p-2 bg-[#0a0a0a] border border-[#00aaaa]" data-testid="delta-display">
      <span className="font-bold">Δ</span>{' '}
      {changes.map((change, i) => (
        <span key={i} data-testid={`delta-${change.stat.toLowerCase()}`}>
          {i > 0 && ', '}
          {change.stat}{' '}
          <span className={change.change > 0 ? 'text-[#00ffaa]' : 'text-[#ff6666]'}>
            {change.change > 0 ? '+' : ''}{change.change}
          </span>
          {change.note && <span className="text-xs"> ({change.note})</span>}
        </span>
      ))}
    </div>
  );
}
