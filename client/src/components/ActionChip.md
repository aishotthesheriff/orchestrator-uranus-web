# ActionChip

Purpose: Clickable action tile showing the action text, short summary, risk tier, and optional item icon. Used to submit user actions during a turn.

Props
- `action: string` — Primary action text (button label).
- `summary: string` — One-line description under the action.
- `risk: 'Safe' | 'Risky' | 'Wild'` — Risk badge and color theme.
- `itemIcon?: string` — Optional item emoji/icon shown on the right.
- `onClick?: () => void` — Invoked when user selects the action.

Behavior
- Press animation via transient local state; logs the action to console for debugging.
- data-testid attributes for action, summary, risk, and optional item icon.

Styling
- Tailwind classes with color variants per risk type.
- Fully responsive; touch-friendly on mobile.

Testing Notes
- Verify `onClick` fires; `data-testid="action-<slug>"` exists.
- Risk badge color matches prop; summary is rendered.
