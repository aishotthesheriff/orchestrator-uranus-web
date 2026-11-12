import { memo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import ItemCard from '@/components/ItemCard';

interface Item {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface EquipmentPanelProps {
  items: Item[];
  equippedItems: string[];
  onToggleItem: (itemId: string) => void;
}

const EquipmentPanel = memo(({ items, equippedItems, onToggleItem }: EquipmentPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div 
      className={`fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 backdrop-blur-xl bg-slate-900/40 border border-white/10 rounded-3xl shadow-2xl transition-all duration-300 ${
        isExpanded ? 'p-4 sm:p-6 w-full max-w-[calc(100vw-2rem)] sm:w-80 max-h-[70vh] overflow-y-auto' : 'p-2 sm:p-3'
      }`}
      data-testid="equipment-panel"
    >
      {/* Glassmorphic shine effect */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>
      
      <div className="relative">
        {/* Header with toggle and count */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Items</h3>
            <span className="text-xs text-white/60 bg-purple-500/20 px-2 py-1 rounded-full">
              {equippedItems.length}/3
            </span>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-11 h-11 sm:w-8 sm:h-8 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
            aria-label={isExpanded ? 'Collapse equipment' : 'Expand equipment'}
            data-testid="equipment-toggle"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-white" />
            ) : (
              <ChevronUp className="w-4 h-4 text-white" />
            )}
          </button>
        </div>

        {isExpanded ? (
          /* Expanded view with all items */
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-sm text-white/60 text-center py-4">No items available</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="backdrop-blur-sm bg-slate-800/30 rounded-xl">
                  <ItemCard
                    name={item.name}
                    description={item.description}
                    icon={item.icon}
                    equipped={equippedItems.includes(item.id)}
                    onToggle={() => onToggleItem(item.id)}
                  />
                </div>
              ))
            )}
          </div>
        ) : (
          /* Compact view with equipped items only */
          <div className="flex gap-2">
            {equippedItems.length === 0 ? (
              <p className="text-xs text-white/60">None equipped</p>
            ) : (
              equippedItems.slice(0, 3).map((itemId) => {
                const item = items.find(i => i.id === itemId);
                return item ? (
                  <div
                    key={itemId}
                    className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-400/50 flex items-center justify-center text-xl"
                    title={item.name}
                    data-testid={`equipped-item-${itemId}`}
                  >
                    {item.icon}
                  </div>
                ) : null;
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
});

EquipmentPanel.displayName = 'EquipmentPanel';

export default EquipmentPanel;

