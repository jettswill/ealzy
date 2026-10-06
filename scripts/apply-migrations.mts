import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
  override: true,
});

const projectRef =
  process.env.SUPABASE_PROJECT_REF ??
  process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(rootDir, "supabase/migrations");

async function listMigrationFiles() {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  if (!files.length) throw new Error(`No migration files in ${migrationsDir}`);
  return files.map((name) => path.join(migrationsDir, name));
}

function skippable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|duplicate/i.test(message);
}

function concurrentCatalogUpdate(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /tuple concurrently updated/i.test(message);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function rollbackQuietly(client?: pg.Client) {
  if (!client) return;
  try {
    await client.query("ROLLBACK");
  } catch {
    // No open transaction to clear after a failed attempt.
  }
}

async function withCatalogRetry<T>(
  label: string,
  run: () => Promise<T>,
  client?: pg.Client,
): Promise<T> {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      await rollbackQuietly(client);
      if (!concurrentCatalogUpdate(error) || attempt === attempts) throw error;
      console.log(`RETRY ${label} (catalog busy, attempt ${attempt}/${attempts})`);
      await sleep(250 * attempt);
    }
  }
  throw new Error(`Unreachable retry state for ${label}`);
}

async function applySql(client: pg.Client, sql: string, label: string) {
  try {
    await withCatalogRetry(
      label,
      async () => {
        await client.query(sql);
      },
      client,
    );
    console.log(`OK  ${label}`);
  } catch (error) {
    await rollbackQuietly(client);
    if (skippable(error)) {
      console.log(`SKIP ${label} (already applied)`);
      return;
    }
    throw error;
  }
}

async function provisionRoles(client: pg.Client) {
  const password = process.env.PGRST_AUTHENTICATOR_PASSWORD;
  if (!password) return;
  const escaped = password.replaceAll("'", "''");
  await withCatalogRetry(
    "authenticator role password",
    async () => {
      await client.query(
        `alter role authenticator with login noinherit password '${escaped}'`,
      );
      await client.query("grant anon, authenticated, service_role to authenticator");
    },
    client,
  );
  console.log("OK  authenticator role password");
}

async function applyViaManagementApi(accessToken: string, sql: string, label: string) {
  if (!projectRef) throw new Error("SUPABASE_URL or SUPABASE_PROJECT_REF is required");
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    if (/already exists/i.test(body)) {
      console.log(`SKIP ${label} (already applied)`);
      return;
    }
    throw new Error(`${label} failed (${response.status}): ${body.slice(0, 500)}`);
  }
  console.log(`OK  ${label}`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!databaseUrl && !accessToken && !dbPassword) {
    console.error("Set DATABASE_URL, SUPABASE_ACCESS_TOKEN, or SUPABASE_DB_PASSWORD.");
    process.exit(1);
  }

  const files = await listMigrationFiles();
  const target = databaseUrl ? "postgres" : projectRef;
  console.log(`Applying ${files.length} migrations to ${target}...\n`);

  if (databaseUrl) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      // Each migration runs once. Before this ledger existed every deploy re-ran
      // all files, so an old migration could undo a newer one (009 re-adding a
      // check that 034 had relaxed) and take production down mid-deploy.
      await client.query("create schema if not exists ealzy_internal");
      await client.query(
        "create table if not exists ealzy_internal.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
      );
      const applied = new Set(
        (await client.query("select name from ealzy_internal.schema_migrations")).rows.map(
          (row: { name: string }) => row.name,
        ),
      );
      let skipped = 0;
      for (const file of files) {
        const label = path.basename(file);
        if (applied.has(label)) {
          skipped += 1;
          continue;
        }
        await applySql(client, await readFile(file, "utf8"), label);
        await client.query(
          "insert into ealzy_internal.schema_migrations(name) values ($1) on conflict do nothing",
          [label],
        );
      }
      if (skipped) console.log(`${skipped} migrations already recorded as applied`);
      await provisionRoles(client);
    } finally {
      await client.end();
    }
  } else {
    for (const file of files) {
      const sql = await readFile(file, "utf8");
      const label = path.basename(file);
      if (accessToken) await applyViaManagementApi(accessToken, sql, label);
      else {
        if (!projectRef) throw new Error("SUPABASE_URL or SUPABASE_PROJECT_REF is required");
        const client = new pg.Client({
          host: `db.${projectRef}.supabase.co`,
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: dbPassword,
          ssl: { rejectUnauthorized: false },
        });
        await client.connect();
        try {
          await applySql(client, sql, label);
        } finally {
          await client.end();
        }
      }
    }
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
