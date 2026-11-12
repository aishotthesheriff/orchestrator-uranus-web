interface ItemCardProps {
  name: string;
  description: string;
  icon: string;
  equipped: boolean;
  onToggle?: () => void;
}

export default function ItemCard({ name, description, icon, equipped, onToggle }: ItemCardProps) {
  return (
    <button
      className={`p-3 border-2 text-left transition-all ${
        equipped
          ? 'border-[#ffaa00] bg-[#1a1000] shadow-[0_0_10px_#ffaa00]'
          : 'border-[#00aaaa] bg-[#0a0a0a] hover:bg-[#001a1a]'
      }`}
      onClick={onToggle}
      data-testid={`item-${name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0" data-testid="item-icon">{icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className={`font-semibold text-sm truncate ${equipped ? 'text-[#ffaa00]' : 'text-[#00ffff]'}`} data-testid="item-name">
            {name}
          </h4>
          <p className="text-xs text-[#00aaaa] line-clamp-2" data-testid="item-description">
            {description}
          </p>
          {equipped && (
            <span className="inline-block mt-1 text-xs font-bold text-[#ffaa00]" data-testid="item-equipped-badge">
              [EQUIPPED]
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
