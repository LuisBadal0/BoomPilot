# Reviewing BoomPilot changes

Read with `AGENTS.md`. Review the diff against `main`, and judge it by what
users of the extension would notice.

## What failure looks like here

Look for these first. Each has happened or nearly happened:

1. **Silence.** Cross-origin media without CORS sent through Web Audio plays
   nothing. Any change to `routeFor`, `createGraph` or the order of checks in
   `applyToMedia` (`content.js`) needs a scenario in `npm run verify`.
2. **Touching pages that were left alone.** Media must not be rerouted, and
   its volume must not change, while the state is the default (100%, effects
   off).
3. **State on the wrong tab or site.** The popup has no `sender.tab`, and
   content scripts do. Site memory is keyed by hostname without `www.`. Watch
   `getMessageTabId`, `applySiteMemory` and `saveTabState` in
   `background.js`.
4. **Lost user volume.** Mute must bring back the previous volume. Reset and
   leaving Limited mode must give the page back its own volume (`base` in
   `applyDirect`).
5. **Slow pages.** Work done on every DOM mutation, slider tick or frame, a
   second injection stacking listeners or AudioContexts, or storage writes
   that aren't batched.
6. **Embedded players.** Changes must keep working in iframes from other
   sites (`all_frames`). Only frames with something to report should answer
   messages.
7. **Packaging and permissions.** New files that end up in the package, new
   permissions without a stated reason, or a `manifest.json` version change
   outside a release PR.

## How to report

- Every finding cites `file:line` and a concrete case: the page, the clicks,
  and what goes wrong. Don't guess from a name. Read the code it calls.
- Mark each finding **Important**, **Nit** or **Pre-existing**. Don't blame the
  author for pre-existing problems.
- At most 3 nits.
- Start the summary with the count ("1 important, 2 nits"), or say "No
  issues found."
- Say whether the PR's **Checks** section shows a real `npm run verify`
  result when code changed, and what it leaves untested.

## Skip

- `package-lock.json`, `assets/*.png`, and wording-only changes in
  `README.md`.
