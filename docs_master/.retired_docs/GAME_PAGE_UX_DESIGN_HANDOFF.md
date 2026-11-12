# Game Page UX Design Handoff — Mobile No-Scroll Redesign

## Overview

This document provides comprehensive design specifications for redesigning the Game Page mobile experience to be a **single-page, no-scroll layout**. All content must fit within the viewport height without requiring vertical scrolling.

**Current State**: Mobile layout uses vertical scrolling with narrative feed, actions, and stats stacked vertically.

**Target State**: All game content visible simultaneously within viewport, using alternative layout patterns (tabs, accordions, overlays, or grid layouts).

---

## Design System & CSS

### Color Palette

**Primary Colors** (Game Theme):
- **Cyan (Primary)**: `#00ffff` - Main UI elements, borders, text
- **Orange (Accent)**: `#ffaa00` - Headers, highlights, warnings
- **Pink/Magenta**: `#ff66ff` - NPCs, special elements, glows
- **Cyan (Secondary)**: `#00aaaa` - Secondary text, muted elements
- **Green (Safe)**: `#00ffaa` - Safe actions, positive states
- **Red (Danger)**: `#ff6666` - Critical stats, hostile NPCs

**Background Colors**:
- **Black (Base)**: `#000000` - Main background
- **Dark Cyan**: `#000a0a` - Card backgrounds, narrative feed
- **Dark Orange**: `#1a1000` - Action panels, equipped items
- **Dark Pink**: `#1a0a1a` - NPC panels, special sections
- **Dark Cyan (Lighter)**: `#001a1a` - Stat panels, secondary cards

**Status Colors**:
- **Critical**: `text-red-500`, `bg-red-600` - Stats < 15%
- **Low**: `text-yellow-400`, `bg-yellow-500` - Stats < 30%
- **Normal**: `text-[#c6f3ff]`, `bg-cyan-600` - Stats ≥ 30%

### Typography

**Font Family**:
- **Monospace**: `font-mono` (Menlo, monospace) - UI elements, headers, stats
- **Body**: Default system font - Narrative text

**Font Sizes** (Mobile):
- **Game Title**: `text-lg` (18px) - Header title
- **Section Headers**: `text-2xl` (24px) - "[ MISSION VIEWSCREEN ]"
- **Narrative**: `text-base` (16px) - Turn narrative text
- **Stat Labels**: `text-sm` (14px) - Stat names
- **Stat Values**: `text-lg` (18px) - Stat numbers
- **Action Text**: `text-sm` (14px) - Action chip text
- **Meta Info**: `text-xs` (12px) - Day/segment, timestamps

**Font Weights**:
- **Bold**: `font-bold` - Headers, stat values, badges
- **Semibold**: `font-semibold` - Section headers
- **Medium**: `font-medium` - Labels, action text
- **Regular**: Default - Body text

**Line Heights**:
- **Narrative**: `leading-relaxed` - Readable prose
- **Default**: Normal - UI elements

### Spacing System

**Tailwind Spacing Scale** (4px base unit):
- `gap-1` = 4px
- `gap-1.5` = 6px
- `gap-2` = 8px
- `gap-3` = 12px
- `gap-4` = 16px
- `gap-6` = 24px

**Common Padding**:
- **Header**: `px-3 py-2` (12px horizontal, 8px vertical)
- **Cards**: `p-4` (16px all sides)
- **Panels**: `p-3` (12px all sides) or `p-6` (24px all sides)
- **Buttons**: `px-4 py-2` (16px horizontal, 8px vertical)

**Common Margins**:
- **Section Spacing**: `mb-4` (16px) or `mb-6` (24px)
- **Element Spacing**: `space-y-3` (12px vertical) or `space-y-4` (16px vertical)

### Borders & Shadows

**Border Styles**:
- **Standard**: `border-2` (2px) with color classes
- **Colors**: `border-[#00ffff]`, `border-[#ffaa00]`, `border-[#ff66ff]`, `border-[#00aaaa]`
- **Radius**: `rounded-lg` (9px) or `rounded-md` (6px)

**Shadow Effects**:
- **Glow**: `shadow-[0_0_20px_#00ffff]` - Cyan glow
- **Orange Glow**: `shadow-[0_0_20px_#ffaa00]` - Orange glow
- **Pink Glow**: `shadow-[0_0_20px_#ff66ff]` - Pink glow
- **Standard**: `shadow-[0_0_15px_#00ffff]` - Subtle glow

**Backdrop Effects**:
- **Header**: `bg-black/90 backdrop-blur-md` - Semi-transparent with blur
- **Overlays**: `bg-black/40` - Semi-transparent backgrounds

### Background Effects

**CRT Background**:
- Component: `CRTBackground` with `intensity="low"`
- Canvas-based animated glyphs
- Filter: `blur(2px) contrast(1.6) brightness(1.3)`
- Flicker animation: `0.14s` infinite
- Position: `absolute inset-0` behind content

**Space Background**:
- Image: `cosmic_space_background_ada85e22.png`
- Position: `absolute inset-0 bg-cover bg-center bg-fixed`
- Opacity: `opacity-20` (20%)
- Z-index: Below content, above CRT

**Z-Index Layers**:
- Background: `z-0` (default)
- Space Image: `z-0` (default)
- CRT Canvas: `z-0` (default)
- Content: `z-10` (relative)
- Header: `z-50` (sticky)
- Dialogs: `z-50+` (Dialog component default)

---

## Current Layout Structure

### Mobile Layout (Current)

```
┌─────────────────────────────────┐
│ Header (sticky, ~56px)          │
│ - Title + Meta                   │
│ - Icon buttons (4)                │
├─────────────────────────────────┤
│ Narrative Feed (scrollable)      │
│ - Loading indicator               │
│ - Current Turn Card               │
│   - Turn badge                    │
│   - Image (optional)              │
│   - Narrative text                │
│   - Checks                        │
│   - Deltas                        │
│ - Previous Turns (toggleable)     │
├─────────────────────────────────┤
│ Actions Panel                     │
│ - Toggle: Suggestions/Custom      │
│ - Action Chips (horizontal wrap)  │
│   OR                              │
│ - Custom Input + Submit           │
├─────────────────────────────────┤
│ Compact Stats Summary             │
│ - 5 CompactStat components        │
│ - WeirdnessMeter                  │
└─────────────────────────────────┘
```

**Current Dimensions** (Estimated):
- **Header**: ~56px height (sticky)
- **Narrative Feed**: Variable height (scrollable, can be very tall)
- **Actions Panel**: ~80-120px (depends on action count)
- **Stats Summary**: ~120px
- **Total Scrollable Height**: 1000px+ (varies with content)

### Viewport Constraints

**Mobile Viewport**:
- **Width**: 375px - 428px (iPhone SE to iPhone 14 Pro Max)
- **Height**: 667px - 926px (varies by device)
- **Safe Area**: Account for notch/home indicator
- **Viewport Meta**: `width=device-width, initial-scale=1.0, maximum-scale=1`

**Available Height** (after header):
- **iPhone SE (667px)**: ~611px available
- **iPhone 14 (844px)**: ~788px available
- **iPhone 14 Pro Max (926px)**: ~870px available

**Critical Constraint**: All content must fit in available height without scrolling.

---

## Component Dimensions

### Header Component

**Current Implementation**:
```tsx
<header className="sticky top-0 z-50 border-b-2 border-[#00ffff] bg-black/90 backdrop-blur-md shadow-[0_0_20px_#00ffff]">
  <div className="container mx-auto px-3 py-2">
    {/* Content */}
  </div>
</header>
```

**Dimensions**:
- **Height**: ~56px (with padding)
- **Padding**: `px-3 py-2` (12px horizontal, 8px vertical)
- **Border**: `border-b-2` (2px bottom border)
- **Position**: `sticky top-0` (fixed at top when scrolling)

**Content**:
- **Left**: Title (`text-lg`) + Meta (`text-xs`) - Stacked vertically
- **Right**: 4 icon buttons (`size="icon"`, ~40px each) with `gap-1.5`

**Redesign Considerations**:
- Keep header height minimal
- Consider collapsible header on mobile
- Icon buttons could be in dropdown menu

### Narrative Feed

**Current Implementation**:
```tsx
<div
  ref={scrollRef}
  className="p-4 border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_15px_#00ffff]"
>
  {/* Turn cards */}
</div>
```

**Dimensions**:
- **Padding**: `p-4` (16px all sides)
- **Border**: `border-2` (2px)
- **Current Behavior**: Scrollable container (can be very tall)

**TurnCard Dimensions**:
- **Padding**: `p-4` (16px all sides)
- **Margin Bottom**: `mb-6` (24px between turns)
- **Turn Badge**: `px-4 py-2` (16px horizontal, 8px vertical)
- **Image**: `w-3/4 h-auto` (75% width, auto height)
- **Narrative**: Variable height (depends on content length)

**Redesign Considerations**:
- **Option 1**: Fixed height with internal scroll (not ideal for no-scroll)
- **Option 2**: Truncate narrative with "Read More" expand
- **Option 3**: Tab/accordion system for multiple turns
- **Option 4**: Card carousel/swiper for turns
- **Option 5**: Collapsible sections with max-height

### Actions Panel

**Current Implementation**:
```tsx
<div className="p-3 border-2 border-[#00ffff] bg-[#000a0a] shadow-[0_0_15px_#00ffff]">
  {/* Actions */}
</div>
```

**Dimensions**:
- **Padding**: `p-3` (12px all sides)
- **Border**: `border-2` (2px)
- **Height**: Variable (80-120px typical)

**ActionChip Dimensions**:
- **Min Width**: `min-w-full sm:min-w-60` (full width on mobile, 240px on larger)
- **Max Width**: `sm:max-w-72` (288px on larger screens)
- **Padding**: `p-3 sm:p-4` (12px mobile, 16px larger)
- **Gap**: `gap-2 sm:gap-3` (8px mobile, 12px larger)
- **Layout**: `flex flex-wrap gap-2` (wraps to multiple rows)

**Redesign Considerations**:
- **Option 1**: Horizontal scroll carousel (swipeable)
- **Option 2**: Grid layout (2x2 or 3x2)
- **Option 3**: Accordion/collapsible with "Show More"
- **Option 4**: Bottom sheet/modal overlay
- **Option 5**: Tab system with action categories

### Stats Summary

**Current Implementation**:
```tsx
<div className="p-3 border-2 border-[#ffaa00] bg-[#1a1000] shadow-[0_0_15px_#ffaa00]">
  {/* Stats */}
</div>
```

**Dimensions**:
- **Padding**: `p-3` (12px all sides)
- **Height**: ~120px
- **Grid**: `grid grid-cols-5 gap-2` (5 columns, 8px gap)

**CompactStat Dimensions**:
- **Icon**: `w-4 h-4` (16px)
- **Label**: `text-[10px]` (10px, very small)
- **Bar**: `h-1.5` (6px height)
- **Value**: `text-xs` (12px)

**WeirdnessMeter**:
- **Height**: ~40px
- **Dots**: 5 dots, `h-3` (12px height each)

**Redesign Considerations**:
- **Option 1**: Collapsible panel (tap to expand)
- **Option 2**: Horizontal scroll carousel
- **Option 3**: Icon-only with tooltips
- **Option 4**: Bottom bar (always visible, minimal)
- **Option 5**: Overlay on tap (modal/bottom sheet)

---

## Current Scroll Behavior

### Window Scroll (Mobile)

**Current Implementation**:
```tsx
// On action click
window.scrollTo({ top: 0, behavior: 'smooth' });
setTimeout(() => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}, 100);
```

**Behavior**:
- Scrolls entire page to top when action is clicked
- Double scroll (immediate + delayed) to ensure it sticks
- Smooth animation

**Redesign Requirements**:
- **No window scrolling** - All content must fit in viewport
- Consider alternative feedback mechanisms:
  - Content fade/transition animations
  - Loading overlay instead of scroll
  - Visual highlight/flash on new content

### Container Scroll (Desktop)

**Current Implementation**:
```tsx
// Desktop uses ref-based scroll
if (scrollRef.current) {
  scrollRef.current.scrollTop = 0;
}
```

**Behavior**:
- Scrolls narrative feed container (not window)
- Used in DesktopGamePage only

**Not Applicable**: Mobile redesign (no container scroll needed)

---

## Animation & Transitions

### Current Animations

**Loading States**:
- **GameContentLoading**: `animate-pulse` on container
- **Spinner**: `animate-spin` on Loader2 icon
- **Duration**: Default Tailwind (varies by animation)

**Button Interactions**:
- **ActionChip**: `scale-95` on press (200ms)
- **Hover**: `hover:shadow-[0_0_15px_currentColor]`
- **Active**: `active:shadow-[0_0_20px_currentColor]`
- **Transition**: `transition-all duration-200`

**Stat Bars**:
- **Width Transition**: `transition-all duration-300` on progress bar
- **Color Changes**: Instant (class-based)

**Weirdness Dots**:
- **Pulse**: `animate-pulse` when filled
- **Warning**: `animate-pulse` when maxed

**CRT Background**:
- **Flicker**: `0.14s infinite` keyframe animation
- **Glyph Updates**: `requestAnimationFrame` loop

### Recommended Animations (No-Scroll Design)

**Content Transitions**:
- **Fade In/Out**: `transition-opacity duration-300` for content changes
- **Slide**: `transform translate-y` for panel transitions
- **Scale**: `transform scale` for modal/overlay appearances

**Loading Feedback**:
- **Overlay**: Full-screen or section overlay (not scroll)
- **Skeleton**: Placeholder content during loading
- **Progress Indicator**: Top bar or inline indicator

**State Changes**:
- **Stat Updates**: Flash animation on change
- **Turn Updates**: Fade in new content
- **Action Selection**: Visual feedback (highlight, checkmark)

---

## Touch Interaction Patterns

### Current Touch Targets

**Buttons**:
- **Icon Buttons**: `size="icon"` (~40px × 40px)
- **Action Chips**: `min-w-full` on mobile (full width, ~44px+ height)
- **Text Buttons**: `px-4 py-2` (minimum 44px height)

**Accessibility**:
- **Minimum Touch Target**: 44×44px (iOS/Android standard)
- **Gap Between Targets**: `gap-2` (8px minimum)

### Recommended Touch Patterns (No-Scroll)

**Swipe Gestures**:
- **Horizontal Swipe**: Navigate between turns, action chips
- **Vertical Swipe**: Switch between sections (if using tabs/accordions)
- **Pull to Refresh**: Reload game state (optional)

**Tap Patterns**:
- **Single Tap**: Select action, expand section
- **Double Tap**: Zoom image (if applicable)
- **Long Press**: Context menu, item details

**Pinch/Zoom**:
- **Disable**: Prevent accidental zoom on double-tap
- **CSS**: `touch-action: pan-x pan-y` or `touch-action: manipulation`

---

## Layout Options for No-Scroll Design

### Option 1: Tab-Based Layout

**Structure**:
```
┌─────────────────────────────────┐
│ Header (~56px)                  │
├─────────────────────────────────┤
│ Tab Bar (~48px)                 │
│ [Narrative] [Actions] [Stats]   │
├─────────────────────────────────┤
│ Content Area (~500-700px)       │
│ - Shows selected tab content     │
│ - No scrolling within tab        │
└─────────────────────────────────┘
```

**Pros**:
- Clear section separation
- Easy navigation
- Familiar pattern

**Cons**:
- Can't see all content at once
- Requires tab switching

**Implementation**:
- Use Radix Tabs or custom tab component
- Each tab shows one section
- Content must fit in available height

### Option 2: Grid Layout

**Structure**:
```
┌─────────────────────────────────┐
│ Header (~56px)                  │
├──────────────┬──────────────────┤
│ Narrative    │ Stats            │
│ (~400px)     │ (~200px)         │
├──────────────┴──────────────────┤
│ Actions (Full Width, ~150px)    │
└─────────────────────────────────┘
```

**Pros**:
- See multiple sections simultaneously
- Efficient space usage
- Natural reading flow

**Cons**:
- Smaller narrative area
- May need truncation
- Complex responsive behavior

**Implementation**:
- CSS Grid: `grid grid-cols-1 md:grid-cols-2`
- Narrative: `col-span-2` or full width
- Stats: Collapsible or always visible
- Actions: Bottom row, full width

### Option 3: Accordion/Collapsible Sections

**Structure**:
```
┌─────────────────────────────────┐
│ Header (~56px)                  │
├─────────────────────────────────┤
│ ▼ Narrative (expanded)          │
│   [Turn content, truncated]      │
├─────────────────────────────────┤
│ ▶ Actions (collapsed)           │
├─────────────────────────────────┤
│ ▶ Stats (collapsed)              │
└─────────────────────────────────┘
```

**Pros**:
- Focus on one section at a time
- Can expand to see more
- Saves vertical space

**Cons**:
- Requires interaction to see all
- May feel hidden

**Implementation**:
- Radix Accordion or custom component
- Default: Narrative expanded
- Others collapsed, expandable

### Option 4: Bottom Sheet Overlays

**Structure**:
```
┌─────────────────────────────────┐
│ Header (~56px)                  │
├─────────────────────────────────┤
│ Narrative (Full height)         │
│ [Turn content]                  │
│                                 │
│                                 │
├─────────────────────────────────┤
│ Actions Bar (Fixed bottom)      │
│ [Action chips, swipeable]       │
└─────────────────────────────────┘
```

**Bottom Sheet**:
- Swipe up from bottom
- Contains: Stats, Previous Turns, Settings
- Overlays narrative when open

**Pros**:
- Narrative always visible
- Actions easily accessible
- Stats available on demand

**Cons**:
- Requires gesture to access stats
- May feel hidden

**Implementation**:
- Custom bottom sheet component
- `transform translate-y` animation
- Backdrop overlay when open

### Option 5: Card Carousel

**Structure**:
```
┌─────────────────────────────────┐
│ Header (~56px)                  │
├─────────────────────────────────┤
│ Turn Carousel (Swipeable)        │
│ [Current Turn Card]             │
│ [Previous Turn Cards...]         │
│                                 │
├─────────────────────────────────┤
│ Actions (Fixed bottom)          │
│ Stats (Icon bar, tap to expand) │
└─────────────────────────────────┘
```

**Pros**:
- Natural mobile pattern
- Easy navigation between turns
- Focus on current content

**Cons**:
- Previous turns require swipe
- Stats may be hidden

**Implementation**:
- Swiper.js or custom carousel
- Horizontal swipe gestures
- Pagination dots or indicators

---

## Content Truncation Strategies

### Narrative Text

**Current**: Full text displayed, scrollable

**Options**:
1. **Line Clamp**: `line-clamp-3` (3 lines) with "Read More" button
2. **Character Limit**: Truncate to ~200 characters with ellipsis
3. **Word Limit**: Show first ~50 words, expand on tap
4. **Height Limit**: `max-h-48` with gradient fade, expand on tap

**Implementation Example**:
```tsx
<div className="max-h-48 overflow-hidden relative">
  <ReactMarkdown>{narrative}</ReactMarkdown>
  <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#000a0a] to-transparent" />
  <button>Read More</button>
</div>
```

### Previous Turns

**Current**: Toggle to show/hide all previous turns

**Options**:
1. **Carousel**: Swipe between turns (Option 5 above)
2. **Accordion**: Expand one at a time
3. **Modal**: Tap to open full turn history
4. **Hidden by Default**: Only show current turn, access via menu

### Action Chips

**Current**: Horizontal wrap, can be multiple rows

**Options**:
1. **Horizontal Scroll**: Swipeable carousel
2. **Grid**: 2x2 or 3x2 grid (fixed height)
3. **Collapsible**: Show 2-3, "Show More" expands
4. **Bottom Sheet**: Tap to open full action list

---

## Technical Constraints

### Viewport Height Management

**CSS Approach**:
```css
.game-page {
  height: 100vh;
  height: 100dvh; /* Dynamic viewport height (accounts for browser UI) */
  display: flex;
  flex-direction: column;
  overflow: hidden; /* Prevent scrolling */
}

.content-area {
  flex: 1;
  overflow: hidden; /* No scrolling */
  display: flex;
  flex-direction: column;
}
```

**JavaScript Approach**:
```tsx
const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

useEffect(() => {
  const handleResize = () => {
    setViewportHeight(window.innerHeight);
  };
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

### Safe Area Insets

**iOS Notch/Home Indicator**:
```css
.game-page {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

**Android Navigation Bar**:
- Use `100dvh` instead of `100vh`
- Account for navigation bar height

### Preventing Scroll

**CSS**:
```css
body {
  overflow: hidden; /* Prevent body scroll */
  position: fixed;
  width: 100%;
  height: 100%;
}

.game-page {
  overflow: hidden; /* Prevent page scroll */
  height: 100vh;
  height: 100dvh;
}
```

**Touch Action**:
```css
.game-page {
  touch-action: pan-x pan-y; /* Allow horizontal swipe, prevent vertical scroll */
  /* OR */
  touch-action: manipulation; /* Disable double-tap zoom, allow pan */
}
```

### Performance Considerations

**Virtual Scrolling** (if needed):
- Use `react-window` or `react-virtualized` for long lists
- Only render visible items
- Not needed if content is truncated

**Image Optimization**:
- Lazy load images outside viewport
- Use `loading="lazy"` attribute
- Consider WebP format

**Animation Performance**:
- Use `transform` and `opacity` for animations (GPU accelerated)
- Avoid animating `height`, `width`, `top`, `left`
- Use `will-change` sparingly

---

## Responsive Breakpoints

**Tailwind Defaults**:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

**Mobile-First Approach**:
- Base styles: Mobile (< 640px)
- `sm:`: Small tablets (≥ 640px)
- `md:`: Tablets (≥ 768px)
- `lg:`: Desktop (≥ 1024px)

**For No-Scroll Mobile**:
- Focus on base styles (mobile)
- Ensure layout works at 375px width
- Test at common heights: 667px, 844px, 926px

---

## Accessibility Requirements

### Touch Targets
- **Minimum Size**: 44×44px (iOS/Android standard)
- **Spacing**: 8px minimum between targets
- **Current**: Action chips meet this (full width on mobile)

### Focus States
- **Visible Focus**: `focus:outline-2 focus:outline-[#00ffff]`
- **Keyboard Navigation**: Tab order must be logical
- **Skip Links**: Consider skip to main content

### Screen Readers
- **ARIA Labels**: All interactive elements
- **Live Regions**: Announce turn updates, stat changes
- **Semantic HTML**: Use proper heading hierarchy

### Color Contrast
- **Text**: 4.5:1 minimum (WCAG AA)
- **Large Text**: 3:1 minimum
- **Current Colors**: Verify contrast ratios

---

## Implementation Checklist

### Design Phase
- [ ] Choose layout option (Tab, Grid, Accordion, Bottom Sheet, Carousel)
- [ ] Create mockups for all screen sizes (375px, 428px widths)
- [ ] Define content truncation strategy
- [ ] Design loading states (no scroll)
- [ ] Design transition animations

### Development Phase
- [ ] Implement viewport height management
- [ ] Add safe area insets support
- [ ] Prevent body/page scrolling
- [ ] Implement chosen layout pattern
- [ ] Add touch gesture support (if needed)
- [ ] Implement content truncation
- [ ] Add loading overlays (not scroll)
- [ ] Test on real devices (iOS/Android)

### Testing Phase
- [ ] Test on iPhone SE (375×667)
- [ ] Test on iPhone 14 (390×844)
- [ ] Test on iPhone 14 Pro Max (428×926)
- [ ] Test on Android devices (various sizes)
- [ ] Test with keyboard navigation
- [ ] Test with screen readers
- [ ] Test with reduced motion preferences
- [ ] Performance testing (60fps animations)

---

## Example Implementation (Tab Layout)

```tsx
<div className="h-screen h-dvh flex flex-col overflow-hidden bg-black">
  {/* Header - Fixed */}
  <header className="sticky top-0 z-50 h-14 border-b-2 border-[#00ffff] bg-black/90 backdrop-blur-md">
    {/* Header content */}
  </header>

  {/* Tab Bar - Fixed */}
  <div className="flex border-b border-[#00aaaa] bg-[#000a0a]">
    <button className="flex-1 py-3 border-b-2 border-[#00ffff]">Narrative</button>
    <button className="flex-1 py-3">Actions</button>
    <button className="flex-1 py-3">Stats</button>
  </div>

  {/* Content Area - Flexible, No Scroll */}
  <div className="flex-1 overflow-hidden">
    {/* Tab content - Must fit in available height */}
    <div className="h-full overflow-hidden">
      {/* Narrative, Actions, or Stats based on active tab */}
    </div>
  </div>
</div>
```

---

## Resources

### Design Files
- **Current Implementation**: `client/src/pages/MobileGamePage.tsx`
- **Components**: `client/src/components/`
- **Design Guidelines**: `design_guidelines.md`

### CSS Framework
- **Tailwind CSS**: Utility-first CSS framework
- **Config**: `tailwind.config.ts`
- **Global Styles**: `client/src/index.css`

### UI Components
- **Radix UI**: Headless components (Dialog, Tabs, Accordion)
- **Shadcn/ui**: Pre-built components using Radix
- **Location**: `client/src/components/ui/`

### Icons
- **Lucide React**: Icon library
- **Usage**: `<Settings className="w-4 h-4" />`

---

## Questions for UX Team

1. **Primary Layout**: Which layout option (Tab, Grid, Accordion, Bottom Sheet, Carousel) best fits the user experience goals?

2. **Content Priority**: What content must always be visible? (Narrative, Actions, Stats)

3. **Navigation Pattern**: How should users navigate between sections? (Tabs, Swipe, Tap)

4. **Previous Turns**: How should users access previous turns? (Carousel, Modal, Hidden)

5. **Loading States**: How should loading be indicated without scrolling? (Overlay, Skeleton, Inline)

6. **Action Selection**: How should actions be presented? (Grid, Carousel, Bottom Sheet)

7. **Stats Visibility**: Should stats always be visible or accessible on demand?

8. **Truncation**: How should long narrative text be handled? (Line clamp, Character limit, Expand)

9. **Animations**: What level of animation/transition is desired? (Minimal, Moderate, Rich)

10. **Accessibility**: Any specific accessibility requirements beyond standard WCAG AA?

---

## Next Steps

1. **Review this document** with UX team
2. **Choose layout approach** based on user research/requirements
3. **Create detailed mockups** for chosen approach
4. **Define component specifications** (dimensions, spacing, interactions)
5. **Hand off to development** with approved designs
6. **Iterate based on testing** and user feedback

