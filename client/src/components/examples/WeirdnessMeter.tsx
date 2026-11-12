import WeirdnessMeter from '../WeirdnessMeter';

export default function WeirdnessMeterExample() {
  return (
    <div className="space-y-6 p-6 bg-background">
      <WeirdnessMeter value={2} />
      <WeirdnessMeter value={4} />
      <WeirdnessMeter value={5} />
    </div>
  );
}
