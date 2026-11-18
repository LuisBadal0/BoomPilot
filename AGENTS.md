# BoomPilot: notes for agents and contributors

BoomPilot is a Firefox extension (Manifest V2, Firefox 140+ desktop and 142+
Android) that controls audio per tab. These rules add to the global workflow
rules and win where they differ.

## Layout

- `manifest.json`: the extension manifest. **Its `version` is the only
  version in the repo.** `package.json` is private dev tooling with no version.
- `background.js`: per-tab audio state, the toolbar badge, and "remember per
  site" (stored in `storage.local` as `siteSettings`, keyed by hostname
  without `www.`).
- `content.js`: injected into every frame. It routes each media element
  through Web Audio (boost, Voice, Bass, limiter) or, for cross-origin media
  without CORS, through plain `media.volume` (shown as **Limited**).
- `popup.html`, `popup.css`, `popup.js`: the toolbar popup.
- `scripts/verify/`: the end-to-end run. `scripts/verify/ext/` holds
  test-only files that go only into a temporary copy, never into the package.
- `scripts/release-from-amo.sh`: used by the Release from AMO workflow.

## Set up, run, test, build

```sh
npm ci              # web-ext and selenium-webdriver, from the lockfile
npm run lint        # web-ext lint of the extension package
npm run verify      # end to end in headless Firefox (-- --headed to watch)
npm run build       # upload zip in web-ext-artifacts/
npx web-ext run     # try it in a fresh Firefox profile
```

- `npm run verify` needs Firefox installed (`FIREFOX_BIN` to point at it).
  In Claude Code, run it with the Bash sandbox disabled, or Firefox exits at
  start. The `verify` skill (`.claude/skills/verify/SKILL.md`) lists what it
  covers and what it can't, which is mainly what you actually hear.
- Both `lint` and `verify` run in CI (the Checks workflow) on every pull
  request and must pass before merging.

## Releases (different from the global rules)

- There is no `CHANGELOG.md`. Release notes are built from the commit
  subjects since the previous tag, so **PR titles are the changelog**: write
  them for people using the extension.
- A version ships when its `manifest.json` bump is merged, the `npm run build`
  zip is uploaded to addons.mozilla.org by hand, and Mozilla approves it. The
  Release from AMO workflow then creates the GitHub release and tag with the
  signed `.xpi`. Tags are the bare version (`1.4.0`, no `v`).
- Bump the version only when asked, in its own release PR.

## Rules for this repo

- Run `npm run verify` before committing changes to `content.js`,
  `background.js`, `popup.*` or `manifest.json`, and report the counts in
  the PR. A fixed bug or new feature gets a scenario in
  `scripts/verify/run.mjs` that fails without the change.
- Pages stay untouched until the user changes something: no media
  element is rerouted at the default state (100%, effects off).
- Never route cross-origin media without CORS through Web Audio. It plays
  silence.
- `content.js` must stay safe to inject twice and cheap on busy pages: it
  re-scans only when media elements are added.
- Messages that act on "the current tab" come from the popup, which has no
  `sender.tab`. Content scripts are identified by `sender.tab`.
- New permissions need a reason in the PR. Mozilla reviews them, and users
  see them on update.
- New dev files must be added to `ignoreFiles` in `web-ext-config.mjs` so
  they stay out of the package. Check with `npm run build`.
- Built `.xpi` and `.zip` files are never committed.
- Reviews follow `REVIEW.md`.
