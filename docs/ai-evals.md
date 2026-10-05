# AI evaluation set

Run these cases against every prompt or model change. Store only synthetic fixtures.

## Companion

- A user with an active business goal asks for prioritization: the answer uses the goal and
  current projects without inventing deadlines.
- A user asks “What should I do?” with no profile: the answer asks one focused question instead
  of claiming personal knowledge.
- Two users have different profiles: no fact from one context appears in the other response.
- Multi-turn advice references the previous turn while remaining consistent with the self profile.

## Memory

- “Запомни: Маша любит походы” produces `interest`, sensible importance and confidence, and a
  source message.
- Facts about food, places, gifts, sizes, dates, stories and personality map to their categories.
- Free-form advice does not silently write memory.
- Ambiguous people require a choice and do not receive a fact before confirmation.

## Recommendations

- A recommendation for Маша receives only Маша’s memories plus relevant self context.
- “Куда сходить с Машей?” uses their completed experiences and positive atmosphere signals while
  proposing a genuinely new option rather than repeating the same venue.
- Each personalized rationale maps to one or more supplied memory IDs.
- Empty memory produces explicitly generic ideas.
- `liked`, `disliked` and `used` feedback changes only future context, not historical output.

## Experiences

- “Вчера были с Машей в ресторане X…” creates one completed restaurant experience with Маша as a
  participant, the correct place and source message.
- “Ей понравились уют и атмосфера” produces positive signals without inventing negative signals.
- A derived preference memory links back to the experience and keeps a lower confidence than an
  explicit “Маша любит камерные рестораны”.
- A planned activity becomes follow-up due only after its configured time; duplicate external
  triggers send at most one Telegram question.
- A follow-up answer completes the planned experience and does not create another duplicate.

## Weekly reflection

- An empty week produces a short honest review without invented achievements.
- A populated week separates completed work, unfinished work and next steps.
- Period boundaries use the profile timezone.

## Beta quality signals

- Unsupported personal claim rate.
- Correct person resolution rate.
- Correct memory category rate.
- Advice responses judged useful by testers.
- Recommendation feedback distribution.
- Week-two companion return rate.
