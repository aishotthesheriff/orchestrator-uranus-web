# CRTBackground

Purpose: Animated CRT/scanline glyph background rendered on a full-screen canvas. Provides vibe/atmosphere for pages with intensity control.

Props
- `intensity?: 'low' | 'medium' | 'high' | 'extreme'` — Visual density, speed and flicker strength (default `high`).

Behavior
- Sizing: resizes canvas to window on mount and on resize.
- Draw loop: requestAnimationFrame paints a grid of glyphs with phosphor-like decay and hue shifts. Density and decay depend on `intensity`.
- CSS: applies filter + keyframed flicker via injected `<style>` tied to intensity.

Performance
- Continuous animation; consider pausing/unmounting when not visible to save CPU.

Testing Notes
- Presence of `<canvas>` with class `crt-canvas`.
- Visual verification (manual) recommended; logic depends on animation frames.
