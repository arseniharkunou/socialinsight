# Project Guardrails

## Supabase Scope

All agents working in this repository must operate only against this Supabase project:

- Project URL: `https://dathibrsfkfanuvatquv.supabase.co`
- Project ref: `dathibrsfkfanuvatquv`
- Project name in Supabase: `Signal Bench`

Do not run migrations, SQL, schema inspection, seed scripts, or data mutations against any other Supabase project for this repository, including other projects in the same organization.

Before using Supabase MCP or direct REST/Postgres access, verify the project ref is exactly `dathibrsfkfanuvatquv`. If a tool exposes multiple projects, ignore all non-matching projects. If the configured `SUPABASE_URL` is not exactly `https://dathibrsfkfanuvatquv.supabase.co`, stop and fix configuration before continuing.

Never expose `SUPABASE_SERVICE_ROLE_KEY` or any other server-side secret in client code, screenshots, logs, commits, or user-facing output.
