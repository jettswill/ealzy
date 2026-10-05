# LifeOS AI beta runbook

## Deploy

1. Apply database migrations `001` through `010` (`docker compose --profile tools run --rm migrate` in production).
2. Configure server-only environment variables from `.env.example`, including Google OAuth.
3. Production auth is Telegram Login plus Google, Apple and Yandex OAuth handled by the API.
   Add `https://ealzy.ru/api/integrations/google/callback` to the Google Cloud client if it is
   missing, and set Apple/Yandex client IDs when those apps exist.
4. Build both workspace applications with `pnpm build`.
5. Deploy the API and Mini App over HTTPS.
6. Register the Telegram webhook:

   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<API_URL>/webhooks/telegram/<SECRET>`

7. Configure the BotFather menu button with `TELEGRAM_MINI_APP_URL`.
8. Configure the external triggers with `x-cron-secret` set to `CRON_SECRET`; do not expose the
   secret to the Mini App:
   - daily or hourly: `POST /internal/experience-follow-ups`
   - every 5–15 minutes: `POST /internal/scheduled-messages` for morning, Monday and evening digests
   - every 15 minutes: `POST /internal/mail-sync` (server skips mailboxes synced in the last two hours)
9. Run the beta smoke journey from `README.md`: `/start` → remember → recommend → companion (bot
   - mini) → experience → follow-up reply → reflection.
10. Run `supabase test db` against the migrated local database to execute the RLS isolation suite.

## Monitor

- Alert on API 5xx rate, Telegram delivery failures and OpenAI timeouts.
- Track AI latency and token usage without storing complete personal prompts in logs.
- Check webhook duplication and database constraint errors after each release.
- Review `beta_metrics` for first self fact, first personal recommendation, week-two Companion use
  and reflection completion. The table contains event metadata, not message or memory content.

## Incident response

- Rotate `TELEGRAM_WEBHOOK_SECRET` if the webhook URL leaks.
- Rotate `TELEGRAM_BOT_TOKEN` through BotFather if the token leaks, then register the webhook again.
- Rotate `SUPABASE_SERVICE_ROLE_KEY` immediately if exposed; it bypasses row-level security.
- Disable recommendations while OpenAI is unavailable; people, memory and tasks remain readable.

## Backup and privacy

- Enable daily Supabase backups before beta onboarding.
- Do not log memory content, Telegram initData or authorization headers.
- Account deletion must remove the user row and cascade all owned people, memories, spaces,
  tasks, messages and recommendations.
