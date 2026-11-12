# DeltaDisplay

Purpose: Inline list of delta changes for stats (e.g., +3 OXYGEN, -2 FUEL) with color-coded signs and optional notes.

Props
- `changes: { stat: string; change: number; note?: string }[]`

Behavior
- Joins changes with commas, applies green for positive and red for negative values.

Testing Notes
- Root `data-testid="delta-display"`; each item `delta-<stat>` exists.
