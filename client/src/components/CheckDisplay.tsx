interface CheckDisplayProps {
  skill: string;
  dc: number;
  roll: number;
  success: boolean;
  description?: string;
}

export default function CheckDisplay({ skill, dc, roll, success, description }: CheckDisplayProps) {
  return (
    <div className={`p-3 my-2 border-2 ${success ? 'border-[#00ffaa] bg-[#001a1a]' : 'border-[#ff6666] bg-[#1a0000]'}`} data-testid="check-display">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base" data-testid="check-icon">🎲</span>
        <span className={`text-sm font-semibold ${success ? 'text-[#00ffaa]' : 'text-[#ff6666]'}`} data-testid="check-text">
          CHECK: {skill.toUpperCase()} DC{dc} → ROLL {roll} {success ? '✅' : '❌'}
        </span>
      </div>
      {description && (
        <p className="text-sm text-[#00aaaa] ml-6" data-testid="check-description">
          {description}
        </p>
      )}
    </div>
  );
}
