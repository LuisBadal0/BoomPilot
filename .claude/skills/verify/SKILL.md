---
name: verify
description: Run BoomPilot end to end in a real Firefox and check that volume changes reach the page's media. Use before committing any change to content.js, background.js, popup.html, popup.js or manifest.json, and whenever asked to verify, test or check the extension.
---

# Verify BoomPilot in Firefox

`npm run verify` installs a throwaway copy of the extension in headless
Firefox, opens local test pages, clicks the real toolbar popup and checks what
the pages' `<audio>` elements actually do. It takes about a minute.

## Run it

1. Once per checkout: `npm ci`.
2. `npm run verify` (add `-- --headed` to watch it).
   - Firefox must be installed. Set `FIREFOX_BIN` if it is not in the usual place.
   - In Claude Code, run it with the Bash sandbox disabled. Firefox can't
     start inside the sandbox and fails with
     `Process unexpectedly closed with status 0`.
3. Read the output. Each line is `PASS` or `FAIL` with what was seen. The
   last line counts both, and the exit code is 1 when anything failed.

## What it covers

| Scenario | What is checked |
| --- | --- |
| Same-origin media (Web Audio) | 200% shows Boosted, the media element is left at 1.0 and keeps playing, badge shows 200 and clears on reset |
| Cross-origin media without CORS (direct) | 50% sets volume to 0.5, a page volume change keeps the reduction, 200% shows Limited, mute/unmute brings back 200%, reset gives the page its volume back |
| Cross-origin media with CORS | 200% shows Boosted, not Limited, and the page keeps playing |
| Embedded player (iframe from another site) | 50% reaches the media inside the frame |
| Media added after the change | Late `<audio>` gets the current volume |
| Remember per site | Saving stores the volume, a new tab on the site starts at it with its badge, forgetting removes it |

## What it does not cover

Say so in the PR's **Checks** section when a change touches these:

- **What you actually hear.** On the Web Audio route the gain is invisible
  to the page, and Firefox still reports a silenced tab as audible, so
  boost levels and "Web Audio plays silence" bugs are only caught through
  the route choice (Limited/Boosted and the media volume).
- Voice and Bass effects, the changed-tabs list, the theme toggle, Firefox
  for Android, and real sites such as YouTube.

## Rules

- Run it before every commit that touches the extension's code, and report
  the real result (counts and any failures) in the PR.
- Don't change a check just to make it pass. If a check is wrong, say why
  and fix it in its own commit.
- No added sleeps or retries to hide a flaky check. Find the cause, or
  remove the check and say why in the commit.
- After three rounds of fixes that still fail, stop and ask.
- A new feature or a fixed bug gets a scenario in `scripts/verify/run.mjs`.
  Confirm the new check fails without the change.

## How it works

- `scripts/verify/fixtures.mjs` serves the test pages from two local
  origins, `localhost` and `127.0.0.1`, which count as two sites.
- `scripts/verify/ext/` holds test-only files that go only into the
  throwaway copy and never into the `.xpi`:
  - `test-background.js` opens the real popup and answers questions
    (tabs, badge, storage).
  - `test-bridge.js` relays commands to it from a local page, because
    WebDriver can't script extension pages.
  - `test-popup-shim.js` points the popup at the page under test and
    clicks its buttons.
- The popup is opened with `browserAction.openPopup()`, not as a tab. A
  popup in a tab sends messages as that tab, and the background would save
  the state to the wrong tab.
