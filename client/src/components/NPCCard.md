# NPCCard

Purpose: Displays an NPC with role, status badge, affinity meter, and optional last interaction quote.

Props
- `name: string`
- `role: string`
- `affinity: number` — Range -3..+3 (displayed across 7 segments).
- `status: NPCStatus` — One of shared schema statuses.
- `lastInteraction?: string`

Behavior
- Status badge and color scheme based on `status`.
- Affinity bar shows positive (green) or negative (red) progression around zero.

Testing Notes
- Root id `npc-<slug>`; `npc-status`, `npc-affinity`, and `affinity-bar-<i>` segments.
