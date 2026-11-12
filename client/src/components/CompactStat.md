# CompactStat

Purpose: Compact resource bar for mobile header. Shows icon, label, progress bar, and numeric value with critical/low coloring.

Props
- `icon: React.ComponentType<{ className?: string }>` — Icon component to render.
- `value: number` — Current value.
- `max: number` — Maximum value for percentage computation.
- `label: string` — Short label (e.g., HULL, OXYGEN).

Behavior
- Computes percentage and applies critical (<15%) or low (<30%) color classes.
- Renders small progress bar and a numeric value in tabular figures.

Testing Notes
- Test IDs include `compact-stat-<label>`, `compact-value-<label>`, and icon/label ids.
