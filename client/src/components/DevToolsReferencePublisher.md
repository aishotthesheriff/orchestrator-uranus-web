# DevToolsReferencePublisher

Purpose: Admin tool to publish and activate reference releases (content catalogs) and show currently active reference.

Behavior
- Shows current active reference with metadata.
- Lists historical releases with activate controls.
- Publish flow: inputs version, author, notes; publishes and (optionally) activates.

Data & API
- Queries:
  - `GET /api/admin/reference/current`
  - `GET /api/admin/reference/releases`
- Mutations:
  - Publish: `POST /api/admin/reference/publish/:version`
  - Activate: `POST /api/admin/reference/:version/activate`
- On success, invalidates reference queries and public reference endpoints used across the app:
  - `['api','reference','story-themes']`, `['api','reference','visual-styles']`, `['api','reference','image-models']`, `['api','reference','system-defaults']`, `['api','reference','settings']`.

Security
- Uses `apiRequest` with admin Authorization and CSRF token management.

Testing Notes
- Publish and Activate flows show toasts and refresh queries.
