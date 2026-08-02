# 0.9.4 Today Ring And Assistant Safe Area Design

## Goal

Make the Today summary progress ring more prominent and prevent the full-screen assistant header from being covered by Android system bars or landscape cutouts. The changes apply to the existing 0.9.4 working copy.

## Scope

- Increase the Today summary progress container from 96px to 112px.
- Increase the Today summary progress ring from 96px to 112px.
- Keep the SVG view box, circle geometry, stroke width, labels, colors, and progress calculation unchanged.
- Keep medication history progress rings unchanged.
- Apply safe-area spacing only when the assistant has the `is-fullscreen` state.
- Add the existing `--safe-top`, `--safe-left`, and `--safe-right` tokens to the full-screen assistant header.
- Keep the existing composer `--safe-bottom` handling unchanged.
- Preserve all existing uncommitted 0.9.4 work.

## Implementation

Update the three fixed size declarations in `src/ui/styles/pages/today.css`: the summary progress container inline and block sizes, the progress ring inline and block sizes, and its fixed flex basis.

Add a full-screen-only header rule in `src/ui/styles/pages/assistant.css`. Its top padding combines `--safe-top` with the existing spacing. Its inline padding uses the larger of the existing spacing and the corresponding left or right safe-area token. The panel itself remains edge-to-edge so the chat layout and available height calculation do not gain duplicate insets.

No TypeScript behavior, persistence, routing, data flow, or error handling changes are required.

## Verification

- Run TypeScript static checks and the relevant UI contract tests.
- Build the web application.
- Preview the Today page and confirm the ring is 112px, the summary content does not overlap, navigation still works, and the browser console has no application errors.
- Check a narrow mobile viewport for clipping or horizontal overflow.
- Add a UI architecture contract that requires the full-screen assistant header to consume the top and inline safe-area tokens.
- Simulate non-zero safe-area values in the browser, expand the assistant, and confirm the title and controls remain inside the safe content region in portrait and short landscape layouts.
- Confirm the normal floating assistant retains its existing spacing and the full-screen composer retains bottom gesture-area protection.
