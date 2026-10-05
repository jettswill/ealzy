# Privacy baseline

LifeOS stores relationship and preference data that may be sensitive. The MVP follows these rules:

- Telegram identity is accepted only after webhook or Mini App signature verification.
- The API derives ownership from the authenticated session and ignores client-supplied owner IDs.
- OpenAI receives only the minimum person context required for the current request.
- Prompts, memory content, initData, tokens and authorization headers are excluded from logs.
- Every stored memory is visible and editable in the Mini App.
- Users can export a JSON copy of their profile, memories, conversations, plans, experiences,
  recommendations and connected mailbox metadata (never IMAP/SMTP passwords) from the More screen.
- Deleting an account cascades through all user-owned entities.
- Mailbox app passwords are encrypted at rest. Ealzy stores recent subject/snippet metadata, not
  full mailbox history, and never sends email until the user confirms.
- Supabase service-role credentials remain server-side; browser builds contain only the API URL.

Beta users must be informed that profile facts may describe third parties and should not include
passwords, payment credentials, medical records or other secrets.
