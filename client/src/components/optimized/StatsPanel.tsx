import { memo, useState } from 'react';
import { ChevronUp, ChevronDown, Rocket, Wind, Fuel, UtensilsCrossed, Heart } from 'lucide-react';
import StatBar from '@/components/StatBar';
import WeirdnessMeter from '@/components/WeirdnessMeter';

interface StatsPanelProps {
  stats: {
    hull: number;
    oxygen: number;
    fuel: number;
    food: number;
    morale: number;
    weirdness: number;
  };
}

const StatsPanel = memo(({ stats }: StatsPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const iconMap = {
    hull: Rocket,
    oxygen: Wind,
    fuel: Fuel,
    food: UtensilsCrossed,
    morale: Heart,
  };

  const statConfig = [
    { key: 'hull', label: 'Hull', icon: '🚀', value: stats.hull, max: 100 },
    { key: 'oxygen', label: 'O2', icon: '💨', value: stats.oxygen, max: 100 },
    { key: 'fuel', label: 'Fuel', icon: '⛽', value: stats.fuel, max: 100 },
    { key: 'food', label: 'Food', icon: '🍽️', value: stats.food, max: 100 },
    { key: 'morale', label: 'Morale', icon: '❤️', value: stats.morale, max: 100 },
  ];

  return (
    <div 
      className={`fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-40 backdrop-blur-xl bg-slate-900/40 border border-white/10 rounded-3xl shadow-2xl transition-all duration-300 ${
        isExpanded ? 'p-4 sm:p-6' : 'p-2 sm:p-3'
      }`}
      data-testid="stats-panel"
    >
      {/* Glassmorphic shine effect */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>
      
      <div className="relative">
        {/* Header with toggle */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Ship Status</h3>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-11 h-11 sm:w-8 sm:h-8 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
            aria-label={isExpanded ? 'Collapse stats' : 'Expand stats'}
            data-testid="stats-toggle"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-white" />
            ) : (
              <ChevronUp className="w-4 h-4 text-white" />
            )}
          </button>
        </div>

        {isExpanded ? (
          /* Expanded view with full stat bars */
          <div className="space-y-4">
            {statConfig.map((stat) => (
              <StatBar
                key={stat.key}
                label={stat.label}
                value={stat.value}
                max={stat.max}
                icon={stat.icon}
              />
            ))}
            <div className="pt-2 border-t border-white/10">
              <WeirdnessMeter value={stats.weirdness} />
            </div>
          </div>
        ) : (
          /* Compact view with icons only */
          <div className="grid grid-cols-5 gap-2">
            {statConfig.map((stat) => {
              const percentage = Math.max(0, Math.min(100, (stat.value / stat.max) * 100));
              const isCritical = percentage < 15;
              const isLow = percentage < 30;
              const Icon = iconMap[stat.key as keyof typeof iconMap];
              
              return (
                <div
                  key={stat.key}
                  className="flex flex-col items-center gap-1"
                  data-testid={`compact-stat-${stat.key}`}
                >
                  <Icon className={`w-5 h-5 ${isCritical ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-purple-400'}`} />
                  <span className={`text-xs font-bold ${isCritical ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-white'}`}>
                    {stat.value}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

StatsPanel.displayName = 'StatsPanel';

export default StatsPanel;

