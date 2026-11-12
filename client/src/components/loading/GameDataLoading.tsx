import { Loader2 } from 'lucide-react';
import CRTBackground from '@/components/CRTBackground';

export default function GameDataLoading() {
  return (
    <div className="relative min-h-screen bg-black flex items-center justify-center font-mono">
      <CRTBackground intensity="low" />
      <div className="relative z-10">
        <Loader2 className="w-8 h-8 animate-spin text-[#00ffff]" />
      </div>
    </div>
  );
}
