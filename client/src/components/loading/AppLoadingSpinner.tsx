interface AppLoadingSpinnerProps {
  message: string;
  progress?: number;
}

export default function AppLoadingSpinner({ message, progress }: AppLoadingSpinnerProps) {
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center font-mono">
      <div className="flex flex-col items-center gap-6">
        <div className="flex gap-2">
          <div className="w-3 h-3 bg-[#00ffff] rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
          <div className="w-3 h-3 bg-[#00ffff] rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
          <div className="w-3 h-3 bg-[#00ffff] rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
        </div>
        
        <div className="text-[#00ffff] text-sm tracking-wider">
          {message}
        </div>

        {progress !== undefined && (
          <>
            <div className="w-64 h-1 bg-[#001a1a] border border-[#00aaaa] overflow-hidden">
              <div 
                className="h-full bg-[#00ffff] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="text-[#00aaaa] text-xs">
              {progress}%
            </div>
          </>
        )}
      </div>
    </div>
  );
}
