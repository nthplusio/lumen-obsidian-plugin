---
description: Commit, bump version, rebuild, tag, and push a release
allowed-tools: Bash, Read, Edit, Glob, Grep, AskUserQuestion
---

You are releasing the Lumen Obsidian plugin. Follow these steps precisely:

## Step 1: Check working state

Run `git status` and `git diff --stat` to see what's changed. If there are no changes to commit (clean tree, nothing staged or unstaged), skip to Step 3 to see if there's an unpushed commit to push. If there's truly nothing to do, tell the user and stop.

## Step 2: Commit changes

1. Run `git diff` and `git diff --cached` to review all changes
2. Stage the relevant files with `git add` (be specific — never use `git add -A`)
3. Write a clear commit message in imperative mood summarizing the changes
4. Commit with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
5. Use a HEREDOC for the commit message

## Step 3: Determine version bump

Read the current version from `package.json`. Then analyze ALL commits since the last version tag to determine the bump type:

```bash
# Find latest version tag
git tag --sort=-v:refname | head -5
# Show commits since that tag
git log <last-tag>..HEAD --oneline
```

Apply semver rules:
- **patch** (1.3.0 -> 1.3.1): Bug fixes, minor improvements, dependency updates, CI changes
- **minor** (1.3.0 -> 1.4.0): New features, new commands, new UI components, significant behavior changes
- **major** (1.3.0 -> 2.0.0): Breaking changes to settings, API, or data format

Present your recommendation to the user with `AskUserQuestion`:
- Show the commits being included
- Explain why you chose the bump level
- Offer patch/minor/major as options with your recommendation marked

## Step 4: Bump version

After the user confirms, run these commands in sequence:

```bash
# Update package.json version
npm version <new-version> --no-git-tag-version

# Sync manifest.json and versions.json
node version-bump.mjs
```

Then verify all three files have the correct version:
- `package.json` — `"version": "<new>"`
- `manifest.json` — `"version": "<new>"`
- `versions.json` — has entry for `"<new>"`

## Step 5: Verify build

Run `npm run build` to verify type-checking passes and the build succeeds. This is a local sanity check only — `main.js` is gitignored and built fresh by the release workflow in CI.

## Step 6: Commit version bump

```bash
git add package.json manifest.json versions.json
git commit -m "Release <new-version>"
```

Do NOT add `Co-Authored-By` to the release commit — keep it clean for `--generate-notes`.

Do NOT stage `main.js` — it is gitignored. The release workflow builds it from source.

## Step 7: Tag and push

```bash
git tag <new-version>
git push && git push --tags
```

The tag push triggers `.github/workflows/release.yml` which:
1. Checks out the tagged commit
2. Runs `npm ci`, `npm run test:run`, `npm run build`
3. Creates a GitHub Release via `gh release create` with `main.js`, `manifest.json`, and `styles.css` as assets
4. Release notes are auto-generated from commits via `--generate-notes`

## Step 8: Confirm

Tell the user:
- The new version number
- How many commits are included in this release
- That the GitHub Actions release workflow has been triggered
- The URL: `https://github.com/nthplusio/lumen-obsidian-plugin/actions`
