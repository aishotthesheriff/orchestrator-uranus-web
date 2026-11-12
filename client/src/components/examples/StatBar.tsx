import StatBar from '../StatBar';

export default function StatBarExample() {
  return (
    <div className="space-y-4 p-6 bg-background">
      <StatBar label="Hull" value={67} max={100} icon="🚀" color="bg-blue-600" />
      <StatBar label="Oxygen" value={45} max={100} icon="💨" color="bg-cyan-600" />
      <StatBar label="Fuel" value={82} max={100} icon="⛽" color="bg-amber-600" />
      <StatBar label="Food" value={28} max={100} icon="🍔" color="bg-green-600" />
      <StatBar label="Morale" value={91} max={100} icon="❤️" color="bg-pink-600" />
    </div>
  );
}
