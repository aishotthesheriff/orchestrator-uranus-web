# ItemCard

Purpose: Equipable item card with icon, name, description, and [EQUIPPED] badge when active. Click toggles equipment.

Props
- `name: string`
- `description: string`
- `icon: string` — Emoji/icon string.
- `equipped: boolean`
- `onToggle?: () => void`

Behavior
- Button-like card; toggles via `onToggle`. Equipped state changes border, background, and shows badge.

Testing Notes
- Root test id `item-<slug>`; includes `item-name`, `item-description`, `item-equipped-badge` when equipped.
