#!/usr/bin/env bash
# Publishes a GitHub release for the version that addons.mozilla.org (AMO)
# currently serves, with the Mozilla-signed .xpi attached.
#
# Does nothing when that release already exists, or when the AMO version is
# not in this repository's history (so a tag never points at the wrong code).
#
# Needs: curl, jq, unzip, sha256sum, git (full history), gh (GH_TOKEN set).
# Set DRY_RUN=1 to print what would happen without creating anything.
set -euo pipefail

ADDON_ID="boompilot@luisbadalo.dev"
API="https://addons.mozilla.org/api/v5/addons/addon/${ADDON_ID}/"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -A "BoomPilot-release-workflow" "$API" -o "$WORK/addon.json"
version="$(jq -r '.current_version.version // empty' "$WORK/addon.json")"
file_url="$(jq -r '.current_version.file.url // empty' "$WORK/addon.json")"
file_hash="$(jq -r '.current_version.file.hash // empty' "$WORK/addon.json")"

if [[ -z "$version" || -z "$file_url" ]]; then
  echo "AMO did not return a current version." >&2
  exit 1
fi
echo "AMO serves version $version"

tag="$version"
if gh release view "$tag" >/dev/null 2>&1; then
  echo "Release $tag already exists. Nothing to do."
  exit 0
fi

# The commit that first set this version in manifest.json.
target="$(git log --reverse --format=%H -S"\"version\": \"$version\"" -- manifest.json | head -n 1)"
if [[ -z "$target" ]]; then
  echo "Version $version is not in this repository's history. Skipping."
  exit 0
fi
echo "Version $version was set in commit $target"

xpi="$WORK/boompilot-${version}.xpi"
curl -fsSL -A "BoomPilot-release-workflow" "$file_url" -o "$xpi"

if [[ "$file_hash" == sha256:* ]]; then
  actual="sha256:$(sha256sum "$xpi" | cut -d' ' -f1)"
  if [[ "$actual" != "$file_hash" ]]; then
    echo "Downloaded file hash $actual does not match AMO's $file_hash." >&2
    exit 1
  fi
fi

if ! unzip -Z1 "$xpi" | grep -Eq '^META-INF/(cose\.sig|mozilla\.rsa)$'; then
  echo "Downloaded file is not signed by Mozilla." >&2
  exit 1
fi

packaged="$(unzip -p "$xpi" manifest.json | jq -r '.version')"
if [[ "$packaged" != "$version" ]]; then
  echo "Package manifest says $packaged, expected $version." >&2
  exit 1
fi

previous="$(git describe --tags --abbrev=0 "${target}^" 2>/dev/null || true)"
{
  if [[ -n "$previous" ]]; then
    echo "## Changes since $previous"
    echo
    git log --format='- %s' "${previous}..${target}"
  else
    echo "## Changes"
    echo
    git log -1 --format='- %s' "$target"
  fi
  echo
  echo "The attached \`boompilot-${version}.xpi\` is the signed Firefox add-on package, as published on [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/boompilot/)."
  if [[ -n "$previous" ]]; then
    echo
    echo "Full changelog: https://github.com/${GITHUB_REPOSITORY:-LuisBadal0/BoomPilot}/compare/${previous}...${tag}"
  fi
} > "$WORK/notes.md"

echo "----- release notes -----"
cat "$WORK/notes.md"
echo "-------------------------"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "DRY_RUN: would create release $tag at $target with $(basename "$xpi")"
  exit 0
fi

gh release create "$tag" "$xpi" \
  --target "$target" \
  --title "BoomPilot $version" \
  --notes-file "$WORK/notes.md"
echo "Created release $tag"
