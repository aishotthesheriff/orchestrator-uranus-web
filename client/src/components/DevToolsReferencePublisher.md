# DevToolsReferencePublisher

Purpose: Admin tool to publish and activate reference releases (content catalogs) and show currently active reference.

Behavior
- Shows current active reference with metadata, and what the release holds (format 2: every content row, enough to set up an empty database; format 1: active rows only).
- **Verify database against this release**: compares the database with the current release, value by value, and lists what differs. Differences are expected after editing content without publishing.
- Hides Activate for a release whose files are not on this server.
- Lists historical releases with activate controls.
- Publish flow: inputs version, author, notes; publishes and (optionally) activates.

Data & API
- Queries:
  - `GET /api/admin/reference/current`
  - `GET /api/admin/reference/releases` (each release includes `filesOnDisk`, `formatVersion`, `workspaceRows`)
  - `GET /api/admin/reference/verify` (read-only; `{ ok, version, checks[], problems[] }`)
- Mutations:
  - Publish: `POST /api/admin/reference/publish/:version`
  - Activate: `POST /api/admin/reference/:version/activate`
- On success, invalidates reference queries and public reference endpoints used across the app:
  - `['api','reference','story-themes']`, `['api','reference','visual-styles']`, `['api','reference','image-models']`, `['api','reference','system-defaults']`, `['api','reference','settings']`.

Security
- Uses `apiRequest` with admin Authorization and CSRF token management.

Testing Notes
- Publish and Activate flows show toasts and refresh queries.
