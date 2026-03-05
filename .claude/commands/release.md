---
description: Commit, bump version, rebuild, tag, and push a release. Automatically detects release channel from branch — stable releases from main, beta prereleases from staging. Handles semver, beta numbering (e.g. 1.11.0-beta.1), manifest-beta.json for BRAT, and GitHub Actions release workflow.
allowed-tools: Bash, Read, Edit, Glob, Grep, AskUserQuestion
---

Release the Lumen Obsidian plugin. Follow these steps precisely.

## Step 0: Detect release channel

```bash
git branch --show-current
```

| Branch    | Channel | Version format        | Manifest asset       | versions.json |
|-----------|---------|-----------------------|----------------------|---------------|
| `main`    | stable  | `1.11.0`              | `manifest.json`      | Updated       |
| `staging` | beta    | `1.11.0-beta.1`       | `manifest-beta.json` | NOT updated   |

If on any other branch, warn and stop.

## Step 1: Check working state

Run `git status` and `git diff --stat`. If clean, skip to Step 3 for unpushed commits. If truly nothing to do, tell the user and stop.

## Step 2: Commit changes

1. Run `git diff` and `git diff --cached` to review changes
2. Stage relevant files with `git add` (never `git add -A`)
3. Commit in imperative mood with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` using a HEREDOC

## Step 3: Determine version bump

```bash
git tag --sort=-v:refname | head -5
git log <last-tag>..HEAD --oneline
```

Semver rules:
- **patch**: Bug fixes, minor improvements, dependency updates, CI changes
- **minor**: New features, new commands, new UI components, significant behavior changes
- **major**: Breaking changes to settings, API, or data format

**Beta (staging)**: Apply the same semver rules for the base version, then append `-beta.N`. Increment N if a beta tag already exists for that base version.

Present recommendation via `AskUserQuestion` showing commits, reasoning, and version options.

## Step 4: Bump version

```bash
npm version <new-version> --no-git-tag-version
node version-bump.mjs
```

**Important**: `npm version` requires the full version string including `-beta.N` for prereleases.

Verify:
- `package.json` and `manifest.json` both show the new version
- **Stable only**: `versions.json` has an entry for the new version
- **Beta only**: `manifest-beta.json` exists with the new version; `versions.json` is unchanged

## Step 5: Verify build

```bash
npm run build
```

Local sanity check only — `main.js` is gitignored and built fresh by CI.

## Step 6: Commit version bump

```bash
# Stable:
git add package.json manifest.json versions.json

# Beta (manifest-beta.json is gitignored):
git add package.json manifest.json
```

```bash
git commit -m "Release <new-version>"
```

No `Co-Authored-By` on the release commit — keeps `--generate-notes` clean. Never stage `main.js`.

## Step 7: Tag and push

```bash
git tag <new-version>
git push && git push --tags
```

This triggers `.github/workflows/release.yml` which builds, tests, and creates a GitHub Release (with `--prerelease` for beta tags).

## Step 8: Update manifest on main (beta only)

BRAT reads `manifest-beta.json` from the repo's default branch (`main`). After a beta release, update it:

```bash
git stash
git checkout main
git checkout staging -- manifest-beta.json
git commit -m "Update manifest-beta.json to <new-version>"
git push
git checkout staging
git stash pop  # only if stash was created
```

## Step 9: Confirm

Tell the user: version number, channel (stable/beta), commit count, and link to https://github.com/nthplusio/lumen-obsidian-plugin/actions
