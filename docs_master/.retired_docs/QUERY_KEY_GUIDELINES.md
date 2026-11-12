# React Query Key Guidelines

This document explains how we structure query keys across the Uranus Dungeon Guide frontend and how the default `getQueryFn` turns those keys into network requests. Use it as the single source of truth when adding new queries or mutations.

## TL;DR Checklist
- Always use an **array** of path segments: `['api', 'reference', 'story-themes']`.
- Do **not** include leading slashes or full URLs in the key.
- Append a final plain object for query-string params: `['api', 'cache', 'images', { templateName: 'hero' }]`.
- Use the identical segmented key when calling `invalidateQueries`, `setQueryData`, or `prefetchQuery`.
- Only fall back to a string key when a third-party hook forces that shape.

## Why Segmented Keys?
Segmented array keys provide:
- Stable identifiers for React Query caches (no duplicate `/api/foo` vs `api/foo`).
- A shared, predictable structure for team members.
- Easier invalidation—copy the same tuple everywhere.
- Automatic URL generation through our shared fetcher.

We previously relied on single string keys (e.g. `['/api/foo']`). The new structure eliminates subtle bugs (double slashes, mismatched invalidations) and centralises query-string handling.

## How `getQueryFn` Uses the Key
`client/src/lib/queryClient.ts` exports `getQueryFn`, which in turn calls `buildUrlFromQueryKey`. Summary of the behaviour:

1. **Segments to URL:** Every array element is coerced to a string, split on `/`, trimmed, and re-joined with `/`. The final path is always prefixed with `/`.
2. **Optional params object:** If the last array element is a plain object, its entries become URLSearchParams. Empty strings, `undefined`, and `null` are skipped.
3. **Abort support:** The hook passes React Query's `signal` to `fetch`.
4. **Auth helpers:** Headers (admin token, CSRF) are injected exactly once.

Example:
```ts
queryClient.prefetchQuery({
  queryKey: ['api', 'cache', 'images', { templateName: 'hero', page: 2 }],
  queryFn,
});
```
produces a request to:
```
/api/cache/images?templateName=hero&page=2
```

## Standard Key Patterns

| Concern | Example key | Notes |
| --- | --- | --- |
| Read-only public APIs | `['api', 'reference', 'image-models']` | Mirrors `/api/reference/image-models` |
| Admin endpoints | `['api', 'admin', 'mod-visual-styles']` | Stick to lowercase segments |
| Entity with parameter | `['api', 'game', gameId]` | Dynamic values become separate segments |
| Optional query string | `['api', 'user', 'search', { pattern }]` | Omit the object if no params |
| Prefetch on startup | `['api', 'reference', 'story-themes']` | Keys shared by all components |

### Dynamic Segments
- Convert IDs to strings but do **not** embed them in a single segment with other text (`['api', 'game', gameId]`, not `['api', `game/${gameId}`]`).
- When IDs might be `null`, guard the query with `enabled` rather than injecting `null` into the key.

### Query Parameters
- Only the trailing plain object becomes query-string parameters.
- Keep values serialisable (`Date` -> `toISOString()`, booleans -> `'true'`/`'false'`).
- Skip empty strings to avoid unexpected `?foo=` in the URL.

## Mutations and Cache Updates
- Use the same segmented key wherever you manipulate cache:
  ```ts
  queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
  queryClient.setQueryData(['api', 'game', gameId], updatedGame);
  ```
- When a mutation affects a collection and a detail item, invalidate both keys explicitly.
- Avoid broad invalidations (`queryClient.invalidateQueries()` with no filter) unless absolutely necessary.

## Legacy and Exceptions
- Legacy components (e.g., archived docs or `.backup` files) may still show string keys. Update them when the code becomes active.
- Some third-party hooks (outside our control) might require string keys; document the exception inline with a comment.
- Server-only caches (Node utilities) are outside the scope of this convention.

## Migration Notes
- Replace each `['/api/...']` with the segmented equivalent in running code and accompanying docs.
- After changing keys, run `npm run check` and smoke-test any screens you touched.
- Update documentation snippets so new contributors do not copy deprecated patterns.

## Reference
- Default query client setup: `client/src/lib/queryClient.ts`
- Query key examples in context: see `client/src/pages/MainMenuPage.tsx`, `client/src/hooks/useGameLogic.ts`.
- Documentation examples: updated MD files under `client/src/pages/**.md`.

Questions or edge cases? Add a note to this document and ping the frontend channel so we keep the convention aligned.
