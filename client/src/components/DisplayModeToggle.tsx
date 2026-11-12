import { Monitor, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DisplayModeToggleProps {
  value: 'modern' | 'terminal';
  onChange: (mode: 'modern' | 'terminal') => void;
  className?: string;
}

export default function DisplayModeToggle({ value, onChange, className = '' }: DisplayModeToggleProps) {
  return (
    <div className={`flex gap-2 ${className}`} data-testid="display-mode-toggle">
      <Button
        variant={value === 'modern' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange('modern')}
        className="flex items-center gap-2"
        data-testid="button-mode-modern"
      >
        <Monitor className="w-4 h-4" />
        Modern
      </Button>
      <Button
        variant={value === 'terminal' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange('terminal')}
        className="flex items-center gap-2"
        data-testid="button-mode-terminal"
      >
        <Terminal className="w-4 h-4" />
        Terminal
      </Button>
    </div>
  );
}
