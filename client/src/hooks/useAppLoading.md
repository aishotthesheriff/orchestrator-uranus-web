# useAppLoading

Purpose: App-level loading flags for major transitions (asset preload, device detection, initial game data load).

State
- `isLoadingAssets: boolean`
- `isDetectingDevice: boolean`
- `isLoadingGameData: boolean`

API
- `setLoading(key, value)` — update one flag.
- `isAppLoading` — derived `true` if any flag is `true`.

Usage
- `LoadingPage` clears `isLoadingAssets` after video preload; other pages can set/clear the remaining flags as needed.
