# Technology Stack

**Analysis Date:** 2026-03-11

## Languages

**Primary:**
- TypeScript 5.8.3 - All source code in `src/` and `tests/`

**Secondary:**
- TSX/JSX - React UI components in `src/ui/`, `src/main-view.tsx`, `src/quick-search-modal.tsx`
- JavaScript (ESM) - Build config `esbuild.config.mjs`, scripts in `scripts/`

## Runtime

**Environment:**
- Obsidian desktop (Electron) — primary runtime target
- Obsidian mobile (iOS/Android) — secondary target (`isDesktopOnly: false` in `manifest.json`)
- Node.js 22 — required for CI/CD (specified in `.github/workflows/ci.yml` and `release.yml`)

**JavaScript target:**
- ES2018 (esbuild output target)
- ES6/DOM lib for TypeScript compilation

**Package Manager:**
- npm 11.6.2
- Lockfile: `package-lock.json` (lockfileVersion 3, present and committed)

## Frameworks

**Core:**
- Obsidian Plugin API (`obsidian` latest) — Plugin lifecycle, Vault, Workspace, Views, Modals
- React 18.3.1 — UI rendering for sidebar panels, modals, and status components
- React DOM 18.3.1 — DOM rendering for React components

**Testing:**
- Vitest 2.1.8 — test runner (watch + single-run modes)
- @vitest/coverage-v8 2.1.8 — v8 code coverage
- @testing-library/react 16.3.2 — React component test utilities
- @testing-library/jest-dom 6.9.1 — custom DOM matchers

**Build/Dev:**
- esbuild 0.25.0 — bundler (watch + production modes)
- TypeScript compiler (`tsc`) — type-checking only (no emit; esbuild handles transpilation)

## Key Dependencies

**Critical:**
- `obsidian` (latest) — Entire plugin API surface: `Plugin`, `requestUrl`, `Vault`, `TFile`, `Platform`, `Notice`, `Modal`, `Menu`, `ItemView`, etc. Externalized from bundle — provided by Obsidian runtime.
- `react` 18.3.1 + `react-dom` 18.3.1 — UI layer for all sidebar views, modals, and interactive components. Bundled into `main.js`.
- `electron` (externalized) — Accessed indirectly via `globalThis.require` for Node.js `https`/`http` modules in `src/chat-client.ts` for SSE streaming on desktop.

**Infrastructure:**
- Web Crypto API (`crypto.subtle.digest`) — SHA-256 hashing in `src/sync/file-hasher.ts`. Available in both Electron and mobile via the global `crypto` object.
- `TextEncoder` / `TextDecoder` — UTF-8 encoding for multipart body construction and SSE parsing.
- `navigator.onLine` + window `online`/`offline` events — Network status detection in `src/utils/network-status.ts`.

**Dev-only:**
- `tslib` 2.8.1 — TypeScript runtime helpers (used with `importHelpers: true`)
- `@types/node` 22.x — Node.js type definitions for `https`/`http` module usage in `ChatClient`
- `@types/react` 18.x, `@types/react-dom` 18.x — React TypeScript types

## Configuration

**TypeScript (`tsconfig.json`):**
- `module: ESNext`, `target: ES6`
- `jsx: react-jsx`, `jsxImportSource: react`
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`
- `strictNullChecks: true`, `noImplicitAny: true`, `noImplicitReturns: true`
- `baseUrl: src` — allows absolute-style imports from `src/`
- `moduleResolution: node`

**esbuild (`esbuild.config.mjs`):**
- Entry: `src/main.ts` → output: `main.js`
- Format: CJS (CommonJS, required by Obsidian plugin loader)
- Target: es2018
- Externalized: `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`
- JSX: `automatic` with `react` import source
- Production: minified, no sourcemaps; dev: inline sourcemaps + watch mode

**Vitest (`vitest.config.ts`):**
- Environment: `node`
- `obsidian` module aliased to `tests/__mocks__/obsidian.ts`
- Coverage excludes `src/main.ts` and `src/settings-tab.ts`
- Coverage provider: v8

**Environment Variables:**
- No `.env` file used by the plugin itself
- Server URL is configurable at runtime via `LumenSettings.serverUrl` (persisted to Obsidian's `data.json`)
- Default API URL hardcoded in `src/types.ts`: `LUMEN_API_URL = 'https://app.getlumen.io'`

**Build:**
- `main.js` is gitignored — never committed
- GitHub Actions (`release.yml`) builds from source and attaches `main.js`, `manifest.json`, `styles.css` as release assets

## Platform Requirements

**Development:**
- Node.js 22 (specified in CI; used for local dev and build)
- npm (lockfile present)
- No linter config in this workspace; ESLint run from monorepo root

**Production:**
- Obsidian 0.15.0+ (minAppVersion in `manifest.json`)
- Desktop (Electron) and Mobile supported
- Self-hosted Lumen server or `https://app.getlumen.io` (configurable)

---

*Stack analysis: 2026-03-11*
