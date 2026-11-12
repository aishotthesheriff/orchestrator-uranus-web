import { memo, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface BackgroundImageProps {
  image: string | null;
  loading: boolean;
  imageVisible?: boolean;
}

const BackgroundImage = memo(({ image, loading, imageVisible = false }: BackgroundImageProps) => {
  const [visible, setVisible] = useState(false);
  const [imageKey, setImageKey] = useState<string | null>(null);

  useEffect(() => {
    if (!image) {
      setVisible(false);
      setImageKey(null);
      return;
    }
    
    // If this is a new image URL, reset visibility and update key
    if (image !== imageKey) {
      setVisible(false);
      setImageKey(image);
      // Small delay to ensure image element is ready
      const timer = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(timer);
    }
  }, [image, imageKey]);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-purple-900 to-slate-900 animate-pulse">
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-16 h-16 text-purple-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (!image) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-purple-900 to-slate-900"></div>
    );
  }

  return (
    <div 
      className={`absolute inset-0 transition-opacity duration-1000 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <img
        key={image}
        src={image}
        alt="Scene background"
        className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${
          imageVisible 
            ? 'opacity-100 blur-0 scale-100' 
            : 'opacity-30 blur-sm scale-150'
        }`}
        loading="eager"
        onLoad={() => {
          // Ensure visibility when image loads
          setVisible(true);
        }}
        onError={() => {
          console.error('[BackgroundImage] Failed to load image:', image);
          setVisible(false);
        }}
      />
      <div className={`absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/50 to-slate-900 transition-opacity duration-500 ${
        imageVisible ? 'opacity-0' : 'opacity-100'
      }`}></div>
    </div>
  );
});

BackgroundImage.displayName = 'BackgroundImage';

export default BackgroundImage;

