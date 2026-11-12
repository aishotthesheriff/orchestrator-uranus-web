import NPCCard from '../NPCCard';

export default function NPCCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 bg-background">
      <NPCCard 
        name="Pilot Lyra"
        role="Navigator"
        affinity={2}
        status="Crush"
        lastInteraction="She appreciated your navigation skills."
      />
      <NPCCard 
        name="Engineer Grom"
        role="Chief Engineer"
        affinity={-1}
        status="Rivalry"
        lastInteraction="Still mad about the duct tape incident."
      />
      <NPCCard 
        name="Doctor Moss"
        role="Medical Officer"
        affinity={0}
        status="Indifferent"
        lastInteraction="Prescribes more paperwork for everything."
      />
      <NPCCard 
        name="Coffee-9000"
        role="Coffee Machine"
        affinity={-2}
        status="Rivalry"
        lastInteraction="Demanding union representation."
      />
    </div>
  );
}
