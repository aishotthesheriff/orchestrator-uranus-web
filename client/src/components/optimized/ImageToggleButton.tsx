import { memo } from 'react';
import { Image, ImageOff } from 'lucide-react';

interface ImageToggleButtonProps {
  isVisible: boolean;
  onClick: () => void;
  hasImage: boolean;
}

const ImageToggleButton = memo(({ isVisible, onClick, hasImage }: ImageToggleButtonProps) => {
  if (!hasImage) return null;

  return (
    <button
      onClick={onClick}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:bottom-6 z-50 w-11 h-11 sm:w-10 sm:h-10 rounded-full backdrop-blur-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/50 transition-all duration-300 flex items-center justify-center touch-manipulation"
      aria-label={isVisible ? 'Hide image' : 'Show image'}
      title={isVisible ? 'Hide image' : 'Show image'}
      data-testid="image-toggle-button"
    >
      {isVisible ? (
        <ImageOff className="w-5 h-5 text-white" />
      ) : (
        <Image className="w-5 h-5 text-white" />
      )}
    </button>
  );
});

ImageToggleButton.displayName = 'ImageToggleButton';

export default ImageToggleButton;

