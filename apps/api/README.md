# LifeOS AI Backend

Backend MVP на Node.js, TypeScript, Express и Supabase PostgreSQL.

## Запуск

Требования: Node.js 22+, pnpm и проект Supabase.

```bash
cd lifeos-ai
pnpm install
cp .env.example apps/api/.env
```

Заполните `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`, затем примените
`supabase/migrations/001_initial_schema.sql` через Supabase CLI или SQL Editor.

```bash
pnpm --filter @lifeos/api dev
```

API будет доступен на `http://localhost:3001`, healthcheck — `GET /health`.

## API

- `POST /api/users`
  - body: `{ "telegram_id": 123, "name": "Анна", "username": "anna" }`
- `POST /api/people`
  - body: `{ "owner_id": "<uuid>", "name": "Маша", "relationship": "подруга", "description": "..." }`
- `POST /api/people/:personId/memories`
  - body: `{ "content": "Любит походы", "category": "interest", "importance": 4, "confidence": 0.95 }`
- `GET /api/people/:personId`
  - возвращает профиль вместе с массивом `memories`
- `GET /api/memories/search?owner_id=<uuid>&q=походы&category=interest&person_id=<uuid>&limit=20`
  - `owner_id` обязателен; остальные параметры опциональны

Успешные ответы имеют форму `{ "data": ... }`. Ошибки содержат
`{ "error": { "code", "message", "requestId" } }`.

## Проверки

```bash
pnpm --filter @lifeos/api typecheck
pnpm --filter @lifeos/api test
pnpm --filter @lifeos/api build
```

`SUPABASE_SERVICE_ROLE_KEY` является серверным секретом и не должен попадать
во frontend или Git. В MVP идентификатор владельца передается явно; перед
публичным запуском API необходимо добавить Telegram-аутентификацию и получать
`owner_id` только из проверенной серверной сессии.
