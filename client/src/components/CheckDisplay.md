# CheckDisplay

Purpose: Displays a single skill check result with DC, roll, success/failure styling, and optional description line.

Props
- `skill: string`
- `dc: number`
- `roll: number`
- `success: boolean`
- `description?: string`

Behavior
- Renders emoji die, uppercase skill, `DC`, and `ROLL` with a ✅/❌ indicator.
- Applies success (teal) vs failure (red) border/background colors.

Testing Notes
- `data-testid="check-display"` root; `check-description` renders only when provided.
