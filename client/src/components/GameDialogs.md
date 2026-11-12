# GameDialogs (HelpDialog)

Purpose: Modal dialog to display in-game help content using shadcn Dialog, with custom CRT-styled header and controls.

Exports
- `HelpDialog({ open, onOpenChange })`

Behavior
- Renders a large modal with header, scrollable content (`HelpContent`), and footer Close button.
- Provides two close controls (button and icon-like "×").

Dependencies
- `HelpContent` for the body content, shadcn Dialog, Button, ScrollArea components.

Testing Notes
- Root test id `help-dialog`; close buttons include `button-close-help`, `icon-close-help`, and footer `footer-close-help`.
