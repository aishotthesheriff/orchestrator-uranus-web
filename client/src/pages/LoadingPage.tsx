import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAppLoading } from '@/hooks/useAppLoading';
import AppLoadingSpinner from '@/components/loading/AppLoadingSpinner';
import videoSplash1 from '@assets/Uranus-HawkingFinal_1761531071513.mp4';
import videoSplash2 from '@assets/Uranus-AskNotWhatUranus_1761533619310.mp4';

export default function LoadingPage() {
  const [, setLocation] = useLocation();
  const { setLoading } = useAppLoading();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const videos = [videoSplash1, videoSplash2];
    let loadedCount = 0;

    const preloadVideo = (src: string): Promise<void> => {
      return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        
        const updateProgress = () => {
          loadedCount++;
          setProgress(Math.round((loadedCount / videos.length) * 100));
        };

        video.oncanplaythrough = () => {
          updateProgress();
          resolve();
        };

        video.onerror = () => {
          updateProgress();
          resolve(); // Still resolve to prevent blocking
        };

        video.src = src;
        video.load();
      });
    };

    Promise.all(videos.map(preloadVideo)).then(() => {
      setLoading('isLoadingAssets', false);
      setTimeout(() => {
        const storedUsername = localStorage.getItem('quest-to-uranus-username');
        if (storedUsername) {
          setLocation('/menu');
        } else {
          setLocation('/welcome');
        }
      }, 300);
    });
  }, [setLocation, setLoading]);

  return (
    <AppLoadingSpinner 
      message="LOADING E.L.O.N. - Edgelord Liguistical Original Narratative UNIT"
      progress={progress}
    />
  );
}
