import DeltaDisplay from '../DeltaDisplay';

export default function DeltaDisplayExample() {
  return (
    <div className="space-y-4 p-6 bg-background">
      <DeltaDisplay 
        changes={[
          { stat: 'Hull', change: -1 },
          { stat: 'Morale', change: 1, note: 'snorts' },
          { stat: 'Weirdness', change: 1, note: 'the form was scented' }
        ]}
      />
      <DeltaDisplay 
        changes={[
          { stat: 'Oxygen', change: 2 },
          { stat: 'Fuel', change: -5 }
        ]}
      />
    </div>
  );
}
