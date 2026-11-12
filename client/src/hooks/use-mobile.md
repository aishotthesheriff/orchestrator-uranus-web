# useIsMobile

Purpose: Detect whether the viewport is mobile-sized (`<768px`) using `window.matchMedia`.

Return
- `boolean | undefined` — `true` for mobile, `false` for desktop, `undefined` during initial detection.

Behavior
- Subscribes to media query changes and updates state.

Usage
- `GamePage` uses this to pick MobileGamePage vs DesktopGamePage; shows a loading UI when `undefined`.
