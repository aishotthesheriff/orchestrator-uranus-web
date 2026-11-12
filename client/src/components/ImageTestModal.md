# ImageTestModal

Purpose: Admin/dev modal to test a single image prompt template: detect variables, input values, select model, generate an image, and inspect debug info.

Props
- `open: boolean`
- `onOpenChange: (open: boolean) => void`
- `templateName: string`
- `promptTemplate: string`
- `inheritVisualStyle: boolean`

Behavior
- Parses variable placeholders like `{{VAR}}` from `promptTemplate` to render inputs.
- Optionally prefixes compiled prompt with `STYLE:` line if `inheritVisualStyle` is true (using the `visual_style_prompt`).
- Loads active image models (admin list) and selects one.
- Calls `/api/test-generate-image` with `templateName` and collected variables, then shows image + debug panel.

Data & API
- Queries:
  - `GET /api/admin/prompt_templates` (to retrieve `visual_style_prompt` content)
  - `GET /api/admin/image-models` (active models)
- Mutation:
  - `POST /api/test-generate-image` (templateName, variables)

Testing Notes
- Generated image test ids: `img-generated`, `textarea-final-prompt`, debug fields `text-debug-*`.
