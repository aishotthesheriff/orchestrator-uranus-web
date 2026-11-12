import TurnCard from '../TurnCard';

export default function TurnCardExample() {
  return (
    <div className="space-y-6 p-6 bg-background max-w-3xl">
      <TurnCard 
        turnNumber={1}
        narrative="The helm asks if 'Uranus' should be pronounced professionally. The crew giggles anyway. You file Form 27-B/UR-A-NUS demanding maturity; it's rejected for 'insufficient gravitas.'"
        checks={[
          {
            skill: 'Bureaucracy',
            dc: 12,
            roll: 9,
            success: false,
            description: "The form was mysteriously scented with lavender."
          }
        ]}
        delta={[
          { stat: 'Morale', change: 1, note: 'snorts' },
          { stat: 'Weirdness', change: 1, note: 'the form was scented' },
          { stat: 'Oxygen', change: -1, note: 'laughing fit' }
        ]}
      />
      <TurnCard 
        turnNumber={2}
        narrative="Coffee-9000 announces it's forming a union. The rest of the crew looks confused. Engineer Grom suggests unplugging it, but Doctor Moss argues that would violate 'machine rights' (which don't exist yet)."
        checks={[
          {
            skill: 'Diplomacy',
            dc: 14,
            roll: 18,
            success: true,
            description: "You promise the coffee machine a 15-minute break every 3 hours. It accepts."
          }
        ]}
        delta={[
          { stat: 'Morale', change: 2 },
          { stat: 'Weirdness', change: 1 }
        ]}
      />
    </div>
  );
}
