import { useIsMobile } from '@/hooks/use-mobile';
import { useAppLoading } from '@/hooks/useAppLoading';
import GameDataLoading from '@/components/loading/GameDataLoading';
import MobileGamePage from './MobileGamePage';
import DesktopGamePage from './DesktopGamePage';
import CompactDesktopGamePage from './CompactDesktopGamePage';
import OptimizedGamePage from './OptimizedGamePage';

export default function GamePage() {
  const isMobile = useIsMobile();
  const { setLoading } = useAppLoading();
  const viewParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;
  const useFullDesktop = !isMobile && viewParam === 'full';
  
  // Handle device detection loading
  if (isMobile === undefined) {
    return <GameDataLoading />;
  }
  
  // Mobile: Default to OptimizedGamePage, allow classic via ?view=classic
  if (isMobile) {
    if (viewParam === 'classic') {
      return <MobileGamePage />;
    }
    // A/B testing: Simple random assignment (50/50 split)
    // In production, this could use a feature flag or user preference
    const useOptimized = typeof window !== 'undefined' 
      ? (localStorage.getItem('game-page-version') || (Math.random() < 0.5 ? 'optimized' : 'classic')) === 'optimized'
      : true;
    
    if (useOptimized) {
      // Store preference for consistency
      if (typeof window !== 'undefined' && !localStorage.getItem('game-page-version')) {
        localStorage.setItem('game-page-version', 'optimized');
      }
      return <OptimizedGamePage />;
    } else {
      if (typeof window !== 'undefined' && !localStorage.getItem('game-page-version')) {
        localStorage.setItem('game-page-version', 'classic');
      }
      return <MobileGamePage />;
    }
  }
  
  // Desktop: Keep existing behavior
  return useFullDesktop ? <DesktopGamePage /> : <CompactDesktopGamePage />;
}
