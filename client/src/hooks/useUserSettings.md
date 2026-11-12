# useUserSettings / useUpdateUserSettings

Purpose: Fetch and update user preference settings (theme, style, imageModelKey) tied to the current session.

APIs
- `GET /api/user/preferences` (session identifies the user)
- `PATCH /api/user/preferences` (update fields)

Behavior
- `useUserSettings` wraps `useQuery` on `['/api/user/preferences']` to load current values.
- `useUpdateUserSettings` wraps `useMutation` for PATCH; on success:
  - Invalidates `['/api/user/preferences']` in QueryClient.
  - Shows a success toast.
  - On error, shows a destructive toast.

Security & CSRF
- Uses `apiRequest` which includes credentials and CSRF for mutating verbs.
