import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import HelpContent from '@/components/HelpContent';

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 bg-black border-2 border-[#00ffff] shadow-[0_0_20px_#00ffff] relative" data-testid="help-dialog">
        <div className="absolute top-3 right-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="border-[#ff66ff] text-[#ff66ff] hover:bg-[#1a0a1a]"
            data-testid="button-close-help"
            title="Close Help"
          >
            CLOSE HELP
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Close help"
            onClick={() => onOpenChange(false)}
            className="border-[#ff66ff] text-[#ff66ff] hover:bg-[#1a0a1a]"
            data-testid="icon-close-help"
            title="Close Help"
          >
            ×
          </Button>
        </div>
        <DialogHeader className="px-6 py-4 border-b-2 border-[#00ffff] bg-black/90">
          <DialogTitle className="text-xl font-bold text-[#00ffff] font-mono drop-shadow-[0_0_10px_#00ffff]">
            HOW TO PROBE URANUS
          </DialogTitle>
          <DialogDescription className="text-[#00aaaa] font-mono">
            Everything you need to know about your mission to Uranus
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-120px)] px-6 py-4 font-mono text-[#00ffff]">
          <HelpContent />
        </ScrollArea>
        <div className="px-6 py-4 border-t-2 border-[#00ffff] bg-black/90 flex justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#00ffff] text-[#00ffff]"
            data-testid="footer-close-help"
          >
            Close Help
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
