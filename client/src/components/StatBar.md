# StatBar

Purpose: Full-size resource bar with label, icon, numeric value, optional daily consumption, and a colored progress bar.

Props
- `label: string`
- `value: number`
- `max: number`
- `icon: string`
- `color?: string` — Tailwind color class for non-low states (default `bg-primary`).
- `dailyConsumption?: number` — If provided, shows `-x/day` inline.

Behavior
- Computes percentage; applies low/critical colors under 30%/15% thresholds.

Testing Notes
- Bar/test ids are namespaced: `stat-<label>`, `value-<label>`, `bar-<label>`, `consumption-<label>` when present.
