import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CRTBackground from '@/components/CRTBackground';
import HelpContent from '@/components/HelpContent';

// Runtime path so build does not require the file; gradient fallback when image is missing
const SPACE_BG_STYLE = {
  backgroundImage:
    'linear-gradient(to bottom, #0a0010 0%, #000 50%, #050010 100%), url(/generated_images/cosmic_space_background_ada85e22.png)',
};

export default function HelpPage() {
  return (
    <div className="relative min-h-screen bg-black font-mono text-[#00ffff]">
      <CRTBackground intensity="medium" />
      
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed opacity-20"
        style={SPACE_BG_STYLE}
      />

      <div className="relative z-10 min-h-screen">
        <header className="sticky top-0 z-50 border-b-2 border-[#00ffff] bg-black/90 backdrop-blur-md shadow-[0_0_20px_#00ffff]">
          <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between">
            <h1 className="text-xl sm:text-2xl font-bold text-[#00ffff] drop-shadow-[0_0_10px_#00ffff]">
              HOW TO PROBE URANUS
            </h1>
            <Link href="/menu">
              <Button
                variant="outline"
                size="sm"
                className="border-[#00ffff] text-[#00ffff]"
                data-testid="button-back-to-menu"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                MENU
              </Button>
            </Link>
          </div>
        </header>

        <div className="container mx-auto px-3 sm:px-4 py-6 max-w-4xl">
          <HelpContent />
          
          <div className="mt-6 p-4 border-2 border-[#ff66ff] bg-[#0a000a] shadow-[0_0_15px_#ff66ff] text-center">
            <p className="text-sm text-[#ff66ff] mb-3">
              ▒▓ STILL CONFUSED? GOOD. THAT'S PART OF THE EXPERIENCE. ▓▒
            </p>
            <Link href="/menu">
              <Button
                variant="outline"
                className="border-[#00ffff] text-[#00ffff]"
                data-testid="button-start-probing"
              >
                START PROBING
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
