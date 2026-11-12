# Design Guidelines — Quest to Uranus (Compacted)

## Design Approach
**Hybrid Reference-Based + Custom Game UI** inspired by Disco Elysium (narrative/checks), FTL (compact stats), terminal interfaces (retro-futuristic), and AI Dungeon (clean text adventure).

**Core Principles:**
1. Comedic Clarity — instant readability despite humor
2. Retro-Futuristic Charm — nostalgic sci-fi + modern UX
3. Narrative Primacy — UI supports, doesn't overwhelm
4. Tactical Feedback — stats/checks/consequences always visible

---

## Typography

**Font Stack (Google Fonts):**
- Headings/UI: "Space Mono" (monospace)
- Body/Narrative: "Inter" (readable)
- Stats/Data: "JetBrains Mono" (crisp numbers)

**Scale:**
- Game Title: `text-4xl font-bold` (Space Mono)
- Section Headers: `text-2xl font-semibold` (Space Mono)
- Narrative: `text-base leading-relaxed` (Inter)
- Stat Labels: `text-sm font-medium uppercase tracking-wide` (JetBrains Mono)
- Stat Values: `text-lg font-bold tabular-nums` (JetBrains Mono)
- Checks/Deltas: `text-sm font-mono` (JetBrains Mono)
- Action Chips: `text-sm font-medium` (Inter)

---

## Layout System

**Spacing:** Use Tailwind units: 2, 3, 4, 6, 8, 12, 16
- Small gaps: `gap-2`, `gap-3`
- Standard padding: `p-4`, `p-6`
- Section spacing: `mb-8`, `mb-12`

**Grid:**
- Container: `max-w-6xl mx-auto px-4`
- Desktop: Two-column (280px sidebar + flex-1 main)
- Mobile: Single column, sidebar collapses to top
- Breakpoint: `md:` for layout shift

---

## Components

### 1. Game Header
- Fixed top bar: `sticky top-0 h-16`
- Contains: Title, turn/segment info, "New Voyage" + "Settings" (right-aligned)

### 2. Ship Stats Dashboard
**Stats (0-100):** Hull, Oxygen, Fuel, Food, Morale
- Label + Value (e.g., "67/100")
- Progress bar: `h-2 rounded-full`
- Icon prefix (🚀 💨 ⛽ 🍔 ❤️)

**Weirdness (0-5):** Distinct 5-dot meter
**Current Day:** Separate display

**Layout:** Vertical stack, `w-80` sidebar (desktop) or horizontal tabs (mobile)

### 3. Narrative Display
- Scrollable feed, `mb-6` between turns
- **Turn Block:**
  - Turn badge (top-left, small, rounded)
  - Narrative text (4-8 sentences, prose formatting)
  - Check callouts (bordered box, `p-3 my-2 rounded`):
    ```
    🎲 Check: Bureaucracy DC 12 → Roll 9 ❌
    [Result text]
    ```
  - Delta line (monospace, compact):
    ```
    Δ Hull -1, Morale +1, Weirdness +1
    ```

### 4. Action Chips
- Fixed bottom, `p-4`, horizontal scroll: `snap-x snap-mandatory`
- **Chip:** `min-w-60 max-w-72 rounded-2xl p-4 gap-3`
  - Action text (font-medium)
  - Risk badge ("Safe"/"Risky"/"Wild")
  - Item icon if applicable
- Shuffle button (right, icon-only, rounded-full)
- "Write your own" toggle → textarea + submit

### 5. Item Inventory
- Sidebar or collapsible panel
- Compact list/3-column grid
- Each: Icon, name (truncated), cooldown indicator
- **Equipped (max 3):** Border/bg emphasis

### 6. NPC Relationship Panel
- Collapsible, 2×2 grid (desktop)
- Each card: Name, role, affinity meter (-3 to +3), status badge, last interaction hint

### 7. Running Gag Sidebar
- Optional collapsed panel, scrollable list with checkmarks/counts

### 8. Fail State Modal
- Full-screen overlay, backdrop blur
- Large failure message, animated icon
- Buttons: "Retry Last Turn" (primary), "New Voyage" (secondary)

### 9. Finale Selection
- 3 large cards (vertical/3-column)
- Each: Title, description, journey callbacks, select button

---

## Component Patterns

**Buttons:**
- Primary: `rounded-lg px-6 py-3 font-semibold`
- Secondary: `rounded-lg px-4 py-2 font-medium border`
- Icon-only: `rounded-full p-2`
- Hover: `scale-1.02`, shadow increase
- On images: `backdrop-blur-sm bg-white/20`

**Cards:**
- Radius: `rounded-lg` (standard), `rounded-xl` (emphasis)
- Borders: `border` or `border-2`
- Shadows: `shadow-sm`, `shadow-md`, `shadow-lg`

**Interactions:**
- Dice roll: 400ms rotation/scale animation
- Stat change: 300ms fade-in delta, 200ms color flash
- Chip tap: Scale 1.05, haptic feedback
- Chip appearance: 50ms stagger fade-in
- Loading: Pulsing dots (inline)
- Scroll: Fade gradients on chip edges

---

## Layouts

**Desktop (≥768px):**
```
[Header: Title | Turn Info | Actions]
[Stats Sidebar (280px)] [Narrative Feed (flex-1)]
                        [Turn blocks, checks, deltas]
[Action Chips (full-width horizontal scroll)]
```

**Mobile (<768px):**
```
[Header]
[Stats (collapsed/tabs)]
[Narrative Feed (scrollable)]
[Action Chips (swipe carousel)]
```

---

## Accessibility

- **Contrast:** 4.5:1 minimum for body text
- **Focus:** Clear keyboard navigation indicators
- **ARIA:** Labels for stats, checks, interactions
- **Touch Targets:** Minimum 44×44px
- **Responsive:** Scale to `text-sm` on mobile where needed
- **Test:** 375px width minimum

---

## Implementation

- **Fonts:** Google Fonts CDN (Space Mono, Inter, JetBrains Mono)
- **Icons:** Heroicons via CDN
- **Framework:** Tailwind utility classes
- **Priority:** Narrative readability—increase line-height/padding when uncertain
- **Animations:** Minimal, purposeful only (no continuous loops)
- **Images:** None required for MVP; optional enhancements (<50KB total, SVG preferred)