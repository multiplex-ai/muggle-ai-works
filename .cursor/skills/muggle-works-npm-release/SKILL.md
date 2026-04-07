---
name: muggle-works-npm-release
description: >-
  Ship @muggleai/works via CI: confirm semver bump kind (patch/minor/major), tag
  vX.Y.Z or workflow dispatch for publish-works-to-npm.yml—no local npm publish.
---

# Muggle Works — npm release

## What to do

1. Read **`muggle-ai-works` root `package.json` → `version`** (semver, no `v`).
2. **Confirm bump kind:** compare that version to the **last published** `@muggleai/works` on npm (e.g. `npm view @muggleai/works version`) or the previous **`v*`** tag. Say explicitly whether this release is **patch**, **minor**, or **major**; **stop and confirm with the user** if it does not match what they intended.
3. **Tag** = **`v` + that version** (e.g. `4.2.6`). Pushing that tag to the default branch triggers [`.github/workflows/publish-works-to-npm.yml`](.github/workflows/publish-works-to-npm.yml) (`on.push.tags: v*`).
4. If `version` on `master` is wrong, fix it (and Electron/checksums if needed) **before** tagging; merge first, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

**Or** skip the tag and run: `gh workflow run publish-works-to-npm.yml --ref master` (optional inputs: exact version or empty + bump)—still **state patch/minor/major** vs npm (or vs current `package.json` before CI bumps it) and confirm.

Do **not** use local **`npm publish`** for this package.

Keep replies short unless the user asks for detail.
