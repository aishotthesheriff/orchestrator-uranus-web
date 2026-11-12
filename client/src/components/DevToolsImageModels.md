# DevToolsImageModels

Purpose: Admin UI for managing image model catalog used by image generation. Supports create/update/delete, sorting, and marking a single default model.

Behavior
- Lists existing models (sorted by `sortOrder`, then `modelKey`).
- Edit form for model fields (provider, names, class, trigger words, active, isDefault).
- Enforces single default: when setting a model as default, the component clears `isDefault` on all other models first.

Data & API
- Queries: `GET /api/admin/image-models`.
- Mutations:
  - Create: `POST /api/admin/image-models`.
  - Update: `PUT /api/admin/image-models/:modelKey`.
  - Delete: `DELETE /api/admin/image-models/:modelKey`.
- React Query invalidations: `['/api/admin/image-models']` after mutations.

Security
- Uses `apiRequest` which attaches admin Authorization header and session credentials; mutating calls include CSRF tokens.

Testing Notes
- Verify default toggle clears other defaults.
- Sorting and table render with truncated text tooltips.
