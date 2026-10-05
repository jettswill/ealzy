# LifeOS AI MVP architecture

The Telegram Bot is the primary write interface. Telegram updates enter the Express webhook,
are deduplicated, mapped to a verified user and passed to the assistant orchestrator. The
orchestrator validates structured OpenAI output before invoking application services; OpenAI
never accesses Supabase directly.

The Mini App is the visual control surface. Inside Telegram it signs in automatically. On the
website a user can create or open the same kind of account with Telegram Login, Apple, Google or
Yandex. Linked identities share one profile.

## Boundaries

- `apps/api`: identity, Telegram transport, AI orchestration and domain APIs.
- `apps/mini-app`: authenticated read/edit experience inside Telegram.
- `supabase/migrations`: reproducible schema and ownership constraints.
- `docs`: privacy and deployment operations.

## Experience Memory

Experiences represent what actually happened, not just what someone likes. An experience records
its type, place, time, participants, emotions, positive and negative signals, outcome and source.
It may link back to a planned task or space.

The assistant can extract a completed experience from an explicit retrospective message. Any
derived preference is saved as a normal person memory with provenance linking it to the source
experience. Recommendations receive both confirmed person memories and relevant past experiences,
so they can suggest something new with a similar atmosphere rather than repeating a popular place.

The API process does not run its own scheduler. Planned activities may have `follow_up_at`. A
repository query exposes due follow-ups to an external scheduled trigger. The Telegram prompt
asks how the activity went, and the answer completes the experience and updates signals.

Optional Telegram digests (morning tasks, Monday weekly plan, evening psychologist-style sync)
are also fired by an external trigger at `POST /internal/scheduled-messages`. Delivery uses the
user's timezone and the times stored on their profile; each kind is sent at most once per local day.

## Product rules

- Explicit “remember” messages may write a fact; ordinary conversation cannot silently create
  memory.
- Ambiguous people require a user choice.
- Recommendations cite stored context and remain useful, but generic, when no memory exists.
- Experience-derived recommendations identify the prior experience or signal behind their rationale.
- Tasks may exist without a space; spaces contain context and participants, not workflow logic.
- Google Calendar sync remains outside the current slice. Meetings found in connected mail become
  dated Ealzy tasks. Mail stays on cached snapshots: the mini-app shows the last
  successful fetch, syncs when the app opens, and the server retries due mailboxes
  at `POST /internal/mail-sync` about every two hours.
- Embeddings and in-process background agents are outside the MVP.
