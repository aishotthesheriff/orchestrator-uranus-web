# DisplayModeToggle

Purpose: Small two-button toggle for switching between 'modern' and 'terminal' display modes.

Props
- `value: 'modern' | 'terminal'`
- `onChange: (mode: 'modern' | 'terminal') => void`
- `className?: string`

Behavior
- Two shadcn Buttons; the active mode uses `variant='default'`, inactive `variant='outline'`.

Testing Notes
- Buttons have test ids: `button-mode-modern`, `button-mode-terminal`.
