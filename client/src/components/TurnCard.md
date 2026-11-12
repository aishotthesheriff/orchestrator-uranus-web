# TurnCard

Purpose: Renders a single turn with title badge, optional image (with pending skeleton), narrative (markdown), checks, delta changes, and a mission viewscreen section with a regenerate button.

Props
- `turnNumber: number`
- `narrative: string`
- `checks?: { skill: string; dc: number; roll: number; success: boolean; description?: string }[]`
- `delta: { stat: string; change: number; note?: string }[]`
- `imageUrl?: string | null`
- `imageTemplate?: string | null`
- `imageStatus?: 'pending' | 'completed' | 'failed'`
- `imageJobId?: string`
- `imagePrompt?: string | null`
- `imageStyle?: string | null`
- `showMissionViewscreen?: boolean`
- `onVisualize?: () => void`
- `isGeneratingImage?: boolean`

Behavior
- Shows a pending skeleton when `imageStatus === 'pending'` and no `imageUrl`.
- Displays image prompt/style details when provided.
- Uses `ReactMarkdown` to render the narrative.

Testing Notes
- Turn container `turn-<n>` and narrative `narrative-<n>` ids; pending skeleton `turn-image-loading-<n>`; image `turn-image-<n>`; button `button-generate-image`.
