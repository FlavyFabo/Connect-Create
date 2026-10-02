# AGENTS.md

## Project

Connect-Create: a platform where people with ideas find passionate
collaborators and make visible progress. What to build is in `SPEC.md`;
this file covers how to work in the repo. If they conflict, stop and ask.

Stack: TypeScript monorepo (pnpm workspaces). Backend Node 22 + Fastify +
Postgres + Drizzle + Zod. Frontend React + Vite + TanStack Query.
Tests with Vitest.

## Commands

Run from the repo root. (If a command doesn't exist yet, creating it is
part of the scaffold task.)

- Install: `pnpm install`
- Dev (api + web): `pnpm dev`
- Typecheck: `pnpm typecheck`
- Lint/format: `pnpm lint` (run before finishing any task)
- Test all: `pnpm test`
- Test one: `pnpm --filter api test -- path/to/file.test.ts`
- DB up (local Postgres): `docker compose up -d db`
- Migrate: `pnpm --filter api db:migrate`
- Generate migration: `pnpm --filter api db:generate`

## Layout

- `apps/api/` Fastify server
  - `src/routes/` HTTP handlers (thin: validate, call service, respond)
  - `src/services/` business logic (matching, progress, guide)
  - `src/db/` Drizzle schema and migrations
- `apps/web/` React app
- `packages/shared/` Zod schemas and types used by both apps
- `SPEC.md` source of truth for requirements (R1, R2, ...)

## Conventions

- TypeScript `strict` on; no `any` (use `unknown` and narrow)
- Define request/response shapes once in `packages/shared` with Zod;
  the API validates with them and the web app infers types from them
- Routes stay thin; logic goes in `services/` so it can be unit tested
- Matching and progress scoring are pure functions with no DB access;
  weights come from config, not inline constants
- Progress is derived from the append-only `progress_events` log; never
  write score values directly
- Tests live next to the code; every acceptance criterion in `SPEC.md`
  gets at least one test
- Reference requirement IDs in commit messages and PRs (e.g. `R11: rank
by match score`)
- Errors: return the status codes listed in `SPEC.md`; bad input is
  `400`, never `500`
- Small, focused commits; one milestone from the Plan at a time
- No new dependencies without asking

## Boundaries

- **Always**
  - Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before declaring done
  - Check authorization on every route that touches a project's workbench
  - Add or update tests when behavior changes
- **Ask first**
  - Schema changes, auth/session changes, new dependencies
  - Changes to the matching weights or progress rule
  - Anything that adds a popularity signal (likes, follower counts,
    view counts); the spec forbids them (R3, R13)
- **Never**
  - Commit secrets, `.env` files, or API keys
  - Call the AI provider from the web app; AI calls go through the API only
  - Include one user's private data in another user's AI prompt (R21)
  - Edit migrations that have already been applied; add a new one
  - Return password hashes or emails of other users in API responses
  - Add features listed under Non-goals in `SPEC.md`

## AI Guide rules

- Prompts include only the requesting project's own content
- Suggestions are proposals; nothing becomes a milestone until the user
  accepts or edits it (R22)
- Nudges are one concrete step, 30 minutes or less, no generic motivation
- Handle model errors and timeouts gracefully; the product must work
  with the guide unavailable

## Gotchas

- Integration tests need the DB running (`docker compose up -d db`)
- New users and projects get a neutral baseline progress value for 14
  days; don't "fix" this in ranking code, it's intentional
- Users cannot confirm their own milestones (403)
- Environment variables are documented in `.env.example`; add new ones
  there, never in code
