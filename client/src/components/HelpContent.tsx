import { HelpCircle } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function HelpContent() {
  return (
    <div className="space-y-6">
      <div className="p-4 sm:p-6 border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_15px_#00ffff]">
        <div className="flex items-start gap-3">
          <HelpCircle className="w-8 h-8 text-[#ffaa00] flex-shrink-0" />
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#ffaa00] mb-2">
              MISSION BRIEFING
            </h2>
            <p className="text-sm text-[#00aaaa] leading-relaxed">
              Welcome, Commander. Your mission: pilot an underqualified ship through cosmic bureaucracy, 
              uppity appliances, and physics with a sense of humor to reach Uranus. Manage resources, 
              navigate bizarre encounters, and try not to die. Good luck out there.
            </p>
          </div>
        </div>
      </div>

      <Accordion type="multiple" className="space-y-4" data-testid="help-accordion">
        <AccordionItem value="resources" className="border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_10px_#00ffff]" data-testid="help-resources">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ SHIP RESOURCES ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div>
              <span className="text-[#00ffff] font-bold">HULL:</span> Your ship's structural integrity. 
              If this hits zero, you become space debris. Avoid asteroids, bureaucratic missiles, and existential dread.
            </div>
            <div>
              <span className="text-[#00ffff] font-bold">OXYGEN:</span> You know, that thing you breathe. 
              Depletes daily at -3/day. Running out leads to unfortunate suffocation situations.
            </div>
            <div>
              <span className="text-[#00ffff] font-bold">FUEL:</span> Makes the ship go zoom. 
              Burns at -4/day. Without it, you're drifting through space contemplating your life choices.
            </div>
            <div>
              <span className="text-[#00ffff] font-bold">FOOD:</span> Keeps the crew from cannibalizing each other. 
              Consumed at -3/day. Morale drops faster when people are hungry. Or being eaten.
            </div>
            <div>
              <span className="text-[#00ffff] font-bold">MORALE:</span> Team spirit and willingness to not mutiny. 
              Drops at -2/day. Critical morale means your crew might "accidentally" space you.
            </div>
            <div>
              <span className="text-[#ff66ff] font-bold">WEIRDNESS METER:</span> Measures how much cosmic absurdity you've encountered. 
              Maxing out at 5/5 summons Reality Auditors who will try to restore boring normalcy. They're worse than they sound.
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="actions" className="border-2 border-[#ffaa00] bg-[#001a0a] shadow-[0_0_10px_#ffaa00]" data-testid="help-actions">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ TAKING ACTIONS ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div>
              Each turn, the AI suggests 3-5 actions based on your current situation. Or you can type your own ridiculous idea—the AI will interpret it.
            </div>
            <div>
              <span className="text-[#00ffaa] font-bold">SAFE:</span> Low risk, moderate rewards. 
              For when you're feeling responsible (boring).
            </div>
            <div>
              <span className="text-[#ffaa00] font-bold">RISKY:</span> Medium risk, better rewards. 
              For when you're feeling lucky (sometimes works).
            </div>
            <div>
              <span className="text-[#ff66ff] font-bold">WILD:</span> High risk, high reward, high hilarity. 
              For when you've decided consequences are someone else's problem.
            </div>
            <div className="pt-2 border-t border-[#00aaaa]/30">
              <span className="text-[#00ffff]">TIP:</span> Some actions use equipped items for bonus effects. 
              Look for the item icon on the action chip!
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="skills" className="border-2 border-[#ff66ff] bg-[#0a000a] shadow-[0_0_10px_#ff66ff]" data-testid="help-skills">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ SKILL CHECKS & DICE ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div>
              Many actions require a d20 skill check. The AI determines the difficulty and which skill applies:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4">
              <div><span className="text-[#00ffff]">•</span> BUREAUCRACY</div>
              <div><span className="text-[#00ffff]">•</span> ENGINEERING</div>
              <div><span className="text-[#00ffff]">•</span> PILOTING</div>
              <div><span className="text-[#00ffff]">•</span> CULINARY</div>
              <div><span className="text-[#00ffff]">•</span> DIPLOMACY</div>
              <div><span className="text-[#00ffff]">•</span> DECEPTION</div>
              <div><span className="text-[#00ffff]">•</span> VIBES</div>
            </div>
            <div className="pt-2">
              <span className="text-[#00ffff] font-bold">ADVANTAGE:</span> Roll two d20s, take the higher. 
              Granted by items, crew bonuses, or cosmic luck.
            </div>
            <div>
              <span className="text-[#ff66ff] font-bold">CRITICAL SUCCESS (20):</span> Bonus rewards and weirdness!
            </div>
            <div>
              <span className="text-red-500 font-bold">CRITICAL FAILURE (1):</span> Things go spectacularly wrong. Often hilarious. Sometimes fatal.
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="items" className="border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_10px_#00ffff]" data-testid="help-items">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ EQUIPMENT & ITEMS ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div>
              You can equip up to <span className="text-[#00ffff] font-bold">3 items</span> at once. 
              Items provide skill bonuses, unlock special actions, or trigger scene effects.
            </div>
            <div>
              <span className="text-[#00ffff]">SKILL BONUSES:</span> Add to your d20 rolls for specific skills. 
              Example: Bureaucratic Briefcase gives +2 to Bureaucracy checks.
            </div>
            <div>
              <span className="text-[#ffaa00]">SCENE EFFECTS:</span> Trigger automatic events or story branches. 
              Example: The Emergency Coffee Maker might save you during a crisis... or create a new one.
            </div>
            <div className="pt-2 border-t border-[#00aaaa]/30">
              <span className="text-[#00ffff]">TIP:</span> Change your loadout based on the situation! 
              Facing bureaucracy? Equip the briefcase. Need to cook? Grab the space brewer.
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="crew" className="border-2 border-[#ffaa00] bg-[#001a0a] shadow-[0_0_10px_#ffaa00]" data-testid="help-crew">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ CREW & NPCs ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div>
              Your crew consists of quirky NPCs with personalities, skills, and opinions about your captaining abilities.
            </div>
            <div>
              <span className="text-[#00ffff] font-bold">AFFINITY:</span> Ranges from -5 (mutiny incoming) to +5 (loyal to a fault). 
              Changes based on your actions and how you treat them.
            </div>
            <div>
              <span className="text-[#ffaa00] font-bold">INTERACTIONS:</span> NPCs may offer help, complain, 
              trigger events, or provide crucial information. Keep them happy... or don't. Your call.
            </div>
            <div className="pt-2 border-t border-[#00aaaa]/30">
              <span className="text-[#00ffff]">TIP:</span> High affinity NPCs might grant advantage on skill checks 
              or bail you out of trouble. Low affinity NPCs might sabotage you. Choose wisely.
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="absurdity" className="border-2 border-[#ff66ff] bg-[#0a000a] shadow-[0_0_10px_#ff66ff]" data-testid="help-absurdity">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ THE ABSURDITY DIAL ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div className="text-[#ff0000] font-bold mb-2">
              ⚠ CURRENTLY UNDER REPAIR ⚠
            </div>
            <div>
              The Absurdity Dial is stuck at maximum chaos (level 3). Command apologizes for the inconvenience, 
              but also notes this was inevitable given the mission destination.
            </div>
            <div className="pt-2 border-t border-[#00aaaa]/30">
              <span className="text-[#ff66ff] font-bold">CURRENT SETTING: 3</span> — Maximum cosmic chaos. Reality is a suggestion.
            </div>
            <div>
              This means: frequent bizarre events, maximum weirdness accumulation, and outcomes that make perfect nonsense.
            </div>
            <div className="text-xs text-[#00ffff] pt-2">
              (Future missions may allow dial adjustment. Or not. The dial does what it wants.)
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="winning" className="border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_10px_#00ffff]" data-testid="help-winning">
          <AccordionTrigger className="px-4 py-3 text-[#ffaa00] font-bold hover:no-underline">
            [ WINNING & LOSING ]
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 text-sm text-[#00aaaa] space-y-3">
            <div className="text-[#00ffaa] font-bold">
              VICTORY:
            </div>
            <div>
              Reach Uranus with your ship (mostly) intact and your crew (mostly) alive. 
              The journey has four segments: Departure, Asteroid Belt, Outer Darkness, and Approach to Uranus.
            </div>
            <div className="text-red-500 font-bold pt-3">
              DEFEAT:
            </div>
            <div className="space-y-2 pl-4">
              <div><span className="text-[#00ffff]">•</span> Hull reaches 0 (ship explodes)</div>
              <div><span className="text-[#00ffff]">•</span> Oxygen reaches 0 (everyone suffocates)</div>
              <div><span className="text-[#00ffff]">•</span> Fuel reaches 0 (stranded forever)</div>
              <div><span className="text-[#00ffff]">•</span> Food reaches 0 (crew turns on each other)</div>
              <div><span className="text-[#00ffff]">•</span> Morale reaches 0 (mutiny or mass despair)</div>
              <div><span className="text-[#00ffff]">•</span> Catastrophic story event (you'll know it when you see it)</div>
            </div>
            <div className="pt-2 border-t border-[#00aaaa]/30">
              <span className="text-[#00ffff]">Remember:</span> Sessions are designed for 10-12 minute playthroughs. 
              Quick, snackable cosmic comedy. Die spectacularly, learn nothing, try again.
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="p-4 border-2 border-[#ff66ff] bg-[#0a000a] shadow-[0_0_15px_#ff66ff] text-center">
        <p className="text-sm text-[#ff66ff]">
          ▒▓ STILL CONFUSED? GOOD. THAT'S PART OF THE EXPERIENCE. ▓▒
        </p>
      </div>
    </div>
  );
}
