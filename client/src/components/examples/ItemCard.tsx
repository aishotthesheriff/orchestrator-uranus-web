import { useState } from 'react';
import ItemCard from '../ItemCard';

export default function ItemCardExample() {
  const [equipped, setEquipped] = useState([true, false, true]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-6 bg-background">
      <ItemCard 
        name="Red Tape Dispenser"
        description="+2 Bureaucracy; reduces Weirdness on authority scenes"
        icon="📋"
        equipped={equipped[0]}
        onToggle={() => setEquipped([!equipped[0], equipped[1], equipped[2]])}
      />
      <ItemCard 
        name="Emergency Cheesecake"
        description="Advantage on Culinary; +1 Morale in crew scenes"
        icon="🍰"
        equipped={equipped[1]}
        onToggle={() => setEquipped([equipped[0], !equipped[1], equipped[2]])}
      />
      <ItemCard 
        name="Universal Allen Key"
        description="+2 Engineering for all repair checks"
        icon="🔧"
        equipped={equipped[2]}
        onToggle={() => setEquipped([equipped[0], equipped[1], !equipped[2]])}
      />
    </div>
  );
}
