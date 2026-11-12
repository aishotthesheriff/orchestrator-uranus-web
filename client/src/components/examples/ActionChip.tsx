import ActionChip from '../ActionChip';

export default function ActionChipExample() {
  return (
    <div className="flex gap-4 p-6 bg-background overflow-x-auto snap-x snap-mandatory">
      <ActionChip 
        action="File complaint about the nebula's color"
        summary="It's not regulation purple. Someone must know."
        risk="Safe"
      />
      <ActionChip 
        action="Bribe the space traffic controller"
        summary="Beans are surprisingly effective currency."
        risk="Risky"
        itemIcon="🫘"
      />
      <ActionChip 
        action="Let Coffee-9000 negotiate"
        summary="The machine seems confident. What could go wrong?"
        risk="Wild"
      />
    </div>
  );
}
