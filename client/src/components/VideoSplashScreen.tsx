import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SkipForward } from 'lucide-react';
import videoSrc from '@assets/Uranus-HawkingFinal_1761531071513.mp4';

interface VideoSplashScreenProps {
  onComplete: () => void;
}

export default function VideoSplashScreen({ onComplete }: VideoSplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fadeOut, setFadeOut] = useState(false);
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    // Show skip button after 2 seconds
    const skipTimer = setTimeout(() => {
      setShowSkip(true);
    }, 2000);

    return () => clearTimeout(skipTimer);
  }, []);

  const handleVideoEnd = () => {
    setFadeOut(true);
    setTimeout(() => {
      onComplete();
    }, 500);
  };

  const handleSkip = () => {
    setFadeOut(true);
    setTimeout(() => {
      onComplete();
    }, 500);
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        autoPlay
        playsInline
        onEnded={handleVideoEnd}
        className="w-full h-full object-cover"
        data-testid="video-splash"
      />
      
      {showSkip && (
        <div className="absolute bottom-8 right-8 animate-in fade-in duration-500">
          <Button
            onClick={handleSkip}
            variant="outline"
            size="lg"
            className="bg-background/80 backdrop-blur-sm hover-elevate"
            data-testid="button-skip-video"
          >
            <SkipForward className="w-4 h-4 mr-2" />
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}
