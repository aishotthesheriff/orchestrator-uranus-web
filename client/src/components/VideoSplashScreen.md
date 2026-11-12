# VideoSplashScreen

Purpose: Primary splash video shown after onboarding; offers skip after a short delay and fades out before calling `onComplete`.

Props
- `onComplete: () => void`

Behavior
- Auto-plays bundled MP4, shows Skip after 2s, fades out with CSS transition, then triggers `onComplete`.

Testing Notes
- Video test id `video-splash`; skip button `button-skip-video`.
