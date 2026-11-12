# WeirdnessMeter

Purpose: Displays the "weirdness" stat as a set of filled dots with numeric value; warns when maxed.

Props
- `value: number`
- `max?: number` — Defaults to 5.

Behavior
- Renders `max` segments; `value` segments are filled and animated.
- Shows a warning line when `value >= max`.

Testing Notes
- Root id `weirdness-meter`; segments `weirdness-dot-<i>`; `weirdness-warning` appears at max.
