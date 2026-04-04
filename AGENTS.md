# AGENTS.md

## Scope

This file applies to the entire repository.

The project is a Tauri app for MH370 geospatial analysis:

- frontend: TypeScript + Vite + Mapbox GL in `src/`
- backend: Rust + Tauri in `src-tauri/`

## Existing Agent Rule Files

At the time this file was written, the repository does **not** contain any of the following:

- `.cursorrules`
- `.cursor/rules/`
- `.github/copilot-instructions.md`

If any of those files are added later, treat them as additional instructions and update this file.

## Working Assumptions

- Prefer small, targeted changes.
- Preserve the uncertainty-first analysis philosophy already present in the code.
- Do not hard-code geospatial assumptions if they are already represented as configurable inputs.
- Keep frontend and backend data contracts aligned.

## Install / Setup

Frontend dependencies:

```bash
pnpm install
```

Rust dependencies are handled by Cargo automatically.

## Build Commands

Run frontend production build:

```bash
pnpm build
```

Run frontend dev server:

```bash
pnpm dev
```

Run Tauri app via CLI wrapper:

```bash
pnpm tauri dev
```

Build/check Rust backend only:

```bash
cd src-tauri && cargo check
```

## Test Commands

Run all Rust tests:

```bash
cd src-tauri && cargo test
```

Run a single Rust test by exact test name:

```bash
cd src-tauri && cargo test classifies_slow_arc67_family
```

Run a single Rust test with full path filtering:

```bash
cd src-tauri && cargo test mh370::paths::tests::classifies_slow_arc67_family
```

Run Rust tests and show stdout:

```bash
cd src-tauri && cargo test -- --nocapture
```

This repo currently has no frontend unit test runner configured.

For frontend validation, use:

```bash
pnpm build
```

## Lint / Format Commands

There is no dedicated JS/TS linter script configured in `package.json`.

TypeScript correctness is enforced primarily by `tsc` through:

```bash
pnpm build
```

Format Rust code with:

```bash
cd src-tauri && cargo fmt
```

Optionally check Rust formatting without changing files:

```bash
cd src-tauri && cargo fmt --check
```

There is no Prettier config or frontend formatter script in the repo.

## High-Value Validation Flow

For backend-only changes:

```bash
cd src-tauri && cargo check && cargo test
```

For frontend-only changes:

```bash
pnpm build
```

For cross-stack changes:

```bash
cd src-tauri && cargo test
pnpm build
```

### Package Manager

- Use `pnpm`, not `npm`, for dependency and script execution in this repo.
- `pnpm-lock.yaml` is present and `src-tauri/tauri.conf.json` is wired to `pnpm` commands.
- If you need to add a frontend dependency, prefer `pnpm add` or `pnpm add -D`.

## Repository Structure

- `src/`: frontend application, layers, UI, model state
- `src/model/`: shared frontend state and typed client-side data models
- `src/ui/`: DOM-driven UI modules
- `src/layers/`: Mapbox layer builders
- `src-tauri/src/lib.rs`: Tauri command registration
- `src-tauri/src/mh370/`: backend analysis modules

## Frontend Style Guidelines

### TypeScript Settings

`tsconfig.json` uses:

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`

Do not introduce code that relies on looser typing.

### Imports

- Keep imports grouped simply; current code does not enforce blank-line grouping.
- Use relative imports within `src/`.
- Use `import type` for type-only imports where practical.
- Prefer explicit named imports over namespace imports.

### Formatting

- Match existing style: semicolons enabled, double quotes, trailing commas only where already natural.
- Keep functions and interfaces near their use unless shared broadly.
- Prefer concise comments; avoid narrating obvious code.

### Types

- Prefer `interface` for frontend object shapes.
- Use explicit return types for exported functions.
- Prefer narrow union-like string fields when the domain is known.
- Avoid `any`.
- Use `unknown` only when crossing a boundary, then narrow immediately.

### Naming

- `camelCase` for variables and functions.
- `PascalCase` for interfaces and type-like structures.
- `UPPER_SNAKE_CASE` for top-level constants.
- Use clear geospatial/domain names such as `arc7`, `satellite`, `drift`, `fuel`, `anomaly`.

### Error Handling

- Async UI flows generally catch at the call site and log with `console.error`.
- Preserve that pattern unless there is a clear UX reason to surface the error.
- Do not silently swallow meaningful failures.
- Prefer guarding early with `if (!element) return;` for DOM access.

### DOM / UI Conventions

- UI is mostly DOM-string and event-listener driven, not React.
- Reuse existing panel/sidebar patterns before inventing new UI systems.
- Design with future analysis modules in mind; avoid one-off layouts that cannot expand.

### Mapbox Conventions

- Layer IDs are prefixed by feature group, e.g. `anomalies-`, `debris-`, `arcs-`.
- If you add a new layer group, update `LAYER_PREFIXES` in `src/main.ts` and `layerVisibility` in `src/map.ts`.
- Keep source IDs and layer IDs consistent by prefix.
- WMS sonar tiles are currently fetched live in the frontend; persistent Rust-side tile caching is intentionally deferred until the live layers are verified.

## Backend Style Guidelines

### Rust Conventions

- Follow `rustfmt` defaults.
- Use `snake_case` for functions and fields.
- Use `PascalCase` for structs and enums.
- Prefer small helper functions for geometry, filtering, and scoring steps.

### Serialization / API Shapes

- Tauri command payloads are serialized with `serde`.
- Derive `Serialize` for data returned to the frontend.
- Derive `Deserialize` only when needed for inbound config/data.
- Keep command response shapes stable unless the frontend is updated in the same change.

### Error Handling

- Prefer `Result<_, String>` for Tauri command-facing functions in this codebase.
- Use descriptive error strings with context.
- Propagate with `?` where possible.
- Avoid `unwrap()` in production code unless the invariant is truly internal and obvious.
- `unwrap()` is acceptable in tests.

### Analysis / Domain Rules

- Preserve the current trust hierarchy encoded in the backend.
- Prefer configuration fields over hard-coded assumptions.
- Keep numerical assumptions inspectable through `AnalysisConfig` when they materially affect results.
- When adding new modeling logic, ask whether the assumption could move the answer by more than ~100 NM; if yes, it likely belongs in config.

## Testing Guidance

- Add Rust unit tests near the module under test using `#[cfg(test)]`.
- Prefer behavioral assertions over brittle exact-value assertions when geometry/model details may evolve.
- If you add a new backend command with nontrivial logic, add at least one focused unit test for the underlying module.

## Agent Expectations

- Read nearby files before changing patterns.
- Keep edits minimal and consistent with current structure.
- For cross-stack changes, update both Rust command contracts and TS consumers together.
- Before finishing, run the narrowest relevant validation commands and report what ran.
