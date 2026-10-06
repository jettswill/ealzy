import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config.js";
import { createDatabase } from "./database.js";
import { SupabaseRepository } from "./repository.js";
import { createApp } from "./app.js";
import { TelegramClient } from "./infrastructure/telegram.js";
import { OpenAiProvider } from "./infrastructure/openai.js";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  override: true,
});

const env = loadEnv();
const database = createDatabase(env);
const repository = new SupabaseRepository(database);
const app = createApp({
  repository,
  env,
  supabaseAuth: database.auth,
  telegram: new TelegramClient(env.TELEGRAM_BOT_TOKEN),
  ai: new OpenAiProvider(
    env.OPENAI_API_KEY,
    env.OPENAI_MODEL,
    env.OPENAI_BASE_URL,
    env.OPENAI_TRANSCRIPTION_MODEL,
    env.OPENAI_COMPANION_MODEL,
  ),
});

const server = app.listen(env.PORT, () => {
  console.log(`LifeOS API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
