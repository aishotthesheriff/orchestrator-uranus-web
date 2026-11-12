import { memo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface NarrativeTextProps {
  text: string;
  typewriterEnabled: boolean;
}

const NarrativeText = memo(({ text, typewriterEnabled }: NarrativeTextProps) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (!typewriterEnabled) {
      setDisplayedText(text);
      setIsTyping(false);
      return;
    }

    setDisplayedText('');
    setIsTyping(true);
    let currentIndex = 0;
    
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        setIsTyping(false);
        clearInterval(interval);
      }
    }, 20); // 20ms per character

    return () => clearInterval(interval);
  }, [text, typewriterEnabled]);

  if (!typewriterEnabled) {
    return (
      <div className="relative">
        <div className="text-base md:text-lg leading-relaxed text-white prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    );
  }

  // For typewriter with markdown, show plain text during typing, then render markdown when complete
  // This provides a smooth typewriter experience while preserving markdown formatting
  return (
    <div className="relative w-full">
      {isTyping ? (
        <p className="text-base md:text-lg leading-relaxed text-white break-words max-w-full">
          {displayedText}
          <span className="inline-block w-0.5 h-4 bg-purple-400 ml-1 animate-pulse"></span>
        </p>
      ) : (
        <div className="text-base md:text-lg leading-relaxed text-white prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
});

NarrativeText.displayName = 'NarrativeText';

export default NarrativeText;

