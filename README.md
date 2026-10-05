# LifeOS AI

Telegram-first personal assistant that remembers important facts about people, produces
context-aware ideas, tracks shared experiences, and turns conversations into lightweight
tasks, goals and spaces.

## Applications

- `apps/api` — Express API, Telegram webhook, Companion chat, experience memory, verified Mini
  App identity, OpenAI orchestration and Supabase repositories.
- `apps/mini-app` — React/Vite Telegram Mini App with Companion, People, Plan (tasks, goals,
  projects), Experiences, Profile and Recommendations.
- `packages/contracts` — Shared Zod runtime contracts for API and client validation.
- `supabase/migrations` — PostgreSQL schema, indexes, ownership constraints and RLS policies.

## Local setup

Requirements: Node.js 22+, pnpm through Corepack and a Supabase project.

```bash
corepack enable
pnpm install
cp .env.example .env
```

Apply migrations in numeric order with Supabase CLI, `pnpm db:migrate`, or the SQL editor:

1. `001_initial_schema.sql`
2. `002_telegram_first_mvp.sql`
3. `003_personal_context.sql` — self profile, companion ledger
4. `004_goals_projects.sql` — goals, projects, task links
5. `005_rich_memory_reflection.sql` — rich memory fields, recommendation feedback, reflections
6. `006_experience_memory.sql` — experiences, follow-ups, preference provenance
7. `007_beta_metrics.sql` — beta quality signals
8. `008_scheduled_notifications.sql` — morning, Monday and evening Telegram digests
9. `009_oauth_identities.sql` — Apple, Google and Yandex sign-in alongside Telegram
10. `010_self_hosted_roles.sql` — PostgREST roles for the production database

One-shot alternative: paste `supabase/bootstrap_all.sql` into the Supabase SQL Editor.

Fill all server secrets in `.env` (including `CRON_SECRET` for experience follow-ups and scheduled
digests). AI runs through
[ZvenoAI](https://zveno.ai/docs/sdks/javascript) via the OpenAI SDK — set `OPENAI_API_KEY` to your
ZvenoAI key, keep `OPENAI_BASE_URL=https://api.zveno.ai/v1`, and pick a model such as
`openai/gpt-4.1`. Voice messages and Telegram video notes use
`OPENAI_TRANSCRIPTION_MODEL=openai/gpt-4o-mini-transcribe`. Then run:

```bash
pnpm --filter @lifeos/api dev
pnpm --filter @lifeos/mini-app dev
```

The API listens on `http://localhost:3001`; the Mini App uses `http://localhost:5173`.

## Telegram setup

1. Create a bot with BotFather.
2. Host API and Mini App over HTTPS.
3. Set `TELEGRAM_MINI_APP_URL` to the hosted Mini App URL.
4. Register the webhook at
   `<API_URL>/webhooks/telegram/<TELEGRAM_WEBHOOK_SECRET>` and configure the same value as
   Telegram's `secret_token`.
5. Open the bot and send `/start`.

## Beta smoke journey

Run this end-to-end with a fresh beta account:

1. `/start` in Telegram — intro examples and Mini App button.
2. `Запомни: Маша любит походы` — person + memory created.
3. `Куда сходить с Машей?` — recommendation with provenance in Mini App.
4. `/companion` then a free-form question — shared ledger in bot and Mini App.
5. `Вчера были с Машей в ресторане X…` — experience captured.
6. Wait for or trigger `POST /internal/experience-follow-ups` with `x-cron-secret`.
7. Reply to the follow-up — planned experience completes without duplicate.
8. `Помоги организовать день рождения мамы` — space, task and recommendation are linked.
9. `/reflection` or Profile → Reflect now — weekly review.
10. Profile → enable morning, Monday and evening notifications — Telegram messages arrive in the configured timezone.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

RLS isolation tests:

```bash
supabase db start
supabase db reset --local
supabase test db
```

For a container smoke deployment:

```bash
docker compose up --build
```

See `docs/architecture.md`, `docs/personal-context.md`, `docs/ai-evals.md`, `docs/privacy.md`
and `docs/runbook.md` before beta deployment.
