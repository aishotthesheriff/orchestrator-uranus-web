# ImageSplashScreen

Purpose: Full-screen splash video overlay (secondary splash) with optional skip button and fade-out transition before continuing.

Props
- `onComplete: () => void` — Called after video ends or when user skips.
- `duration?: number` — Unused in current video-based implementation.

Behavior
- Auto-plays a bundled MP4, shows Skip after 2s, and fades out before invoking `onComplete`.

Testing Notes
- Root test id `image-splash`; video `video-splash-second`; skip `button-skip-second-video`.
