# Personal AI Context

LifeOS builds a bounded context pack on the backend for companion, recommendation and reflection
requests. OpenAI never chooses arbitrary database rows.

## Context order

1. Self profile: bio, values, communication style, locale and timezone.
2. Confirmed self memories ordered by importance and recency.
3. Active goals and projects.
4. Current tasks and spaces.
5. Recent messages from the primary companion conversation.
6. A resolved person and their memories when the request names a person.
7. Relevant completed experiences, shared participants, emotions and positive/negative taste signals.
8. Prior recommendation outcomes relevant to the request.

Each section has a hard item limit. Missing information is omitted rather than inferred. Context
must never cross an `owner_id` boundary.

## Memory writes

Free-form companion advice is read-only by default. A fact is stored only when:

- the user explicitly says to remember it; or
- LifeOS proposes a structured fact and the user confirms it.

Every memory records category, importance, confidence, source and creation time. Sensitive
information such as credentials, payment data and medical records must not be suggested for
storage.

## Response rules

- Advice should refer to known context only when it materially affects the recommendation.
- The assistant must distinguish known facts from assumptions.
- If context is insufficient, it should ask one focused question or give clearly generic advice.
- Recommendations include a rationale and the IDs of memories used to produce them.
- Experience-aware recommendations include the experience IDs that established the taste pattern.
- A failed AI request must not create or partially mutate domain records.
