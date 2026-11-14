# Database

Quest to Uranus stores its data in **MariaDB 10.6 or later** (the local stack runs 11.8, the version Hostinger runs). This page covers how the schema is defined, how a new database is set up from a published release, how the app talks to the database, and what to know when writing SQL.

## Quick reference

| Task | Command |
|---|---|
| Set up an empty database (schema, then the newest release) | `npm run db:init` |
| Create or update the schema only | `npm run db:migrate` |
| Check that the database matches its current release | `npm run db:verify-release` |
| Replace all content with the newest release | `npm run db:recreate` |
| Check whether a server can run the app | `DATABASE_URL=mysql://... npm run db:probe` |
| Delete players, games, jobs and the image cache rows | `npx tsx scripts/reset-game-data.ts` |
| Run the tests that use the database | `npm run test:integration` |

Scripts read `DATABASE_URL` from the environment, or from `.env` when it is not set.

## Connecting

`DATABASE_URL` is `mysql://user:password@host:3306/database` (`mariadb://` also works). User and password may be percent-encoded.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | The database the app uses. |
| `DATABASE_URL_TEST` | The database the tests use. Its name must end in `_test`. Tests never use `DATABASE_URL`. |
| `DB_POOL_MAX` | Most connections one app process opens (default 20). Set it below the host's per-user connection cap, divided by the number of app processes (Hostinger runs two). |

Locally, `docker compose up -d` starts MariaDB with two databases, `uranus_dungeon` and `uranus_dungeon_test`, both owned by user `uranus` (password `password`), on port 3306.

## Schema

The schema is the SQL in [`server/db/schema/`](../../server/db/schema/). `001_baseline.sql` creates the tables the app started with; `002_socket_events.sql` adds the table that passes live updates between app processes (see [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md)). `npm run db:migrate` applies the files in name order and records each one, with a checksum, in the `schema_migrations` table.

To change the schema, add a new file (`002_....sql`). Rules for these files:

- **Do not edit a file that has been applied.** The runner compares checksums and stops if one changed.
- **Write every statement so it can be repeated** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). MariaDB commits each DDL statement on its own, so a file that fails halfway is applied again from the top.
- **One statement per `;` at the end of a line.** Lines starting with `--` are ignored.
- **No content rows.** Content comes from a release (below).

### Conventions

| Kind of column | Type | Why |
|---|---|---|
| Ids, keys, usernames, release versions, statuses, hashes | `VARCHAR(n) COLLATE utf8mb4_bin` | Compared exactly. `Joey` and `joey` are different users. |
| Names and other short text | `TEXT` | |
| Prompts, narration, errors, anything long | `MEDIUMTEXT` | `TEXT` stops at 64 KB. |
| JSON documents | `JSON` | Returned to the app already parsed. |
| Timestamps | `DATETIME(3)`, UTC | Use `NOW(3)` in SQL so milliseconds are kept. |
| True/false | `BOOLEAN` | Returned as `true`/`false`. The older 0/1 flags (`active`, `is_complete`, `is_current`) are `INT`. |
| Hashes stored as bytes | `VARBINARY(32)` | |
| Money | `DECIMAL(12,6)` | Returned as a string. |

Strict mode is on: a value that is too long or of the wrong type is an error, never silently cut. Lengths worth knowing: usernames 64, release versions 64, model keys 80, setting keys and prompt names 128.

### "At most one" rules

MariaDB has no partial unique indexes. Each such rule is a generated column that is NULL when the rule does not apply, with a unique index on it (unique indexes ignore NULLs). These columns are `INVISIBLE`, so `SELECT *` does not return them.

| Rule | Column |
|---|---|
| One pending or processing image job per game turn | `image_jobs.active_slot` |
| One default story theme | `mod_story_themes.default_slot` |
| One default visual style | `mod_visual_styles.default_slot` |

## Setting up a database from a release

Content (prompts, items, events, NPCs, image prompts, models, themes, styles, settings, interview questions, Inspector scenarios) is edited in Dev Tools and published as a release under `releases/`. See [REFERENCE_RELEASE_PUBLISHING.md](REFERENCE_RELEASE_PUBLISHING.md). A release holds two things:

- **Runtime files** (`items.json`, `prompts.json`, ...): the active rows, in the shape the game loads. The game reads these from `releases/current/`, not from the database.
- **`workspace/`**: every row of every content table, active and inactive, exactly as stored. This is what a database is loaded from.

`npm run db:init` sets up an empty database:

1. Applies the schema.
2. Picks the release: the most recently published one on disk, or `--version <v>`.
3. Validates it before writing anything: files present, checksums and row counts match `metadata.json`, every column exists in the database, required values present.
4. Refuses to continue if any content table already has rows (`--replace` deletes that content first).
5. Loads all content tables in one transaction. Any error rolls the whole load back.
6. Records every release found on disk in `reference_releases` and marks the loaded one current.
7. Verifies the result (next section) and exits with code 1 if anything differs.

If `releases/current/` holds a different release than the one being loaded, the command stops unless `--activate` is given, because switching it changes what the game loads.

Game data (users, games, jobs, logs, the image cache) is never touched by these commands.

Releases published before the workspace existed (format 1) can still be loaded. They hold active rows only and no interview questions; the four Inspector presets then come from `server/db/seeds/pce_presets.json`.

### What is in git

`releases/` is ignored except `releases/current/` and the version it was made from, so a fresh clone can run `npm run db:init`. After publishing a new release, update the version named in `.gitignore` and commit both folders.

## Verifying

`npm run db:verify-release`, the **Verify** button in Dev Tools > Reference Publisher, and `GET /api/admin/reference/verify` all run the same read-only check:

- The database is re-exported the way publishing does it, and each runtime file is compared with the release's, value by value.
- Every content table is dumped and compared with the release's `workspace/` file.
- The default model, style and theme must be the same.
- The database's current release, `releases/current/`, and the release being checked must all be the same version.

A difference after editing content in Dev Tools is expected: it means there are unpublished changes.

`GET /api/health` reports `reference: { status, version, dbVersion, inSync }`. `inSync` is the cheap part of this check: the database and `releases/current/` name the same release.

## How the app talks to the database

All access goes through `pool` in [`server/db.ts`](../../server/db.ts):

```ts
const result = await pool.query("SELECT * FROM games WHERE id = $1", [id]);
result.rows;      // array of rows
result.rowCount;  // rows returned, or rows matched by a write
```

For a transaction, use `withTransaction`. It commits when the function returns, rolls back when it throws, and runs the function again if InnoDB reports a deadlock or a lock wait timeout, so the function must not have effects outside the database.

```ts
await withTransaction(async (client) => {
  await client.query("UPDATE ...", [...]);
  await client.query("INSERT ...", [...]);
});
```

Things the wrapper does for you:

- **Placeholders.** SQL is written with `$1, $2, ...`. They are translated to MariaDB's `?`, so a number can be reused or appear out of order.
- **Dates.** A `Date` parameter is sent as UTC, and `DATETIME` columns come back as UTC `Date`s. The driver on its own would use the Node process's time zone.
- **Parameters.** `undefined` becomes NULL. Plain objects and arrays are sent as JSON text.
- **Session.** Every connection uses UTC, `READ COMMITTED` isolation, strict mode, a 100-second lock wait, and a one-hour idle timeout (`wait_timeout`). The last two are set for Hostinger: see [Hostinger limits](#hostinger-limits).

### Writing SQL for MariaDB

| Need | Write |
|---|---|
| The row you just inserted or deleted | `INSERT ... RETURNING *`, `DELETE ... RETURNING *` |
| The row you just updated | `UPDATE t SET ... WHERE key = $N RETURNING *`. MariaDB has no such statement; the wrapper runs the update, then selects by that key. Only this exact shape is accepted, and the key column must not be one being set. |
| Upsert | `INSERT ... ON DUPLICATE KEY UPDATE`, or read then write inside `withTransaction` |
| Claim rows without waiting on other workers | `SELECT ... FOR UPDATE SKIP LOCKED` in a transaction, then `UPDATE` |
| Change one key of a JSON column | `JSON_SET(col, '$.key', JSON_QUERY($1, '$'))`. A bare parameter would be stored as a quoted string. |
| Read a JSON field in SQL | `JSON_VALUE(col, '$.field')`. A JSON `true` comes back as `1`. |
| Conditional counts | `COUNT(CASE WHEN ... THEN 1 END)` |
| Case-insensitive search | `LIKE` on a column with the default collation |
| A column named `key`, `default` or `rank` | Quote it with backticks |

React to errors with the helpers in [`server/db/errors.ts`](../../server/db/errors.ts) (`isUniqueViolation`, `isMissingTable`, `isRetryableLockError`), not with error numbers at the call site.

### Connections and turns

A turn is applied inside one transaction that holds the game's row lock (`processTurnWithTransaction`), and the code it runs makes further queries on other connections. To keep those queries from being starved, turn transactions may use at most half the pool at once; the rest wait their turn.

## Tests

Tests that use the database run against `DATABASE_URL_TEST` (read from `.env` if not set in the environment). The pool refuses to start under Vitest without it, and refuses a database whose name does not end in `_test`. The schema is created on first use. Test files run one at a time because they share the database.

- `server/__tests__/mariadb.port.test.ts`: value types, the `UPDATE ... RETURNING` replacement, job claiming under concurrency, the queue.
- `server/__tests__/releaseInit.test.ts`: loading a release into an empty database, refusal and rollback cases, drift detection.
- `server/db/placeholders.test.ts`: placeholder translation, dates, URL parsing (no database needed).

## Qualifying a server

`npm run db:probe` reports a server's version and limits and tries every feature the app depends on in throwaway tables named `zz_probe_*`, which it drops afterwards. It exits with code 1 if the server cannot run the app. The hard requirements are MariaDB 10.6 or later and `max_allowed_packet` of at least 16 MB. Run it against a new host before deploying, and set `DB_POOL_MAX` from the connection cap it reports.

## Hostinger limits

Measured on 2026-11-13 with `npm run db:probe` against a scratch database on the Business web hosting plan (server `srv529.hstgr.io`). All 20 checks passed.

| Setting | Value on Hostinger | What the app does about it |
|---|---|---|
| Version | MariaDB 11.8.9 | Needs 10.6 or later. The local stack runs 11.8. |
| `max_allowed_packet` | 1024 MB | Nothing; the app needs 16 MB. |
| Connections per user (`MAX_USER_CONNECTIONS`) | 75 | `DB_POOL_MAX` defaults to 20. Hostinger runs two app processes, so up to 40 can be in use; scripts count too. |
| New connections per hour (`MAX_CONNECTIONS_PER_HOUR`) | 500 | The pool keeps spare connections for 10 minutes instead of reconnecting after every burst. |
| Idle timeout (`wait_timeout`) | 20 seconds | Each connection sets its own `wait_timeout` to one hour. Without this the server closes pooled connections, and every reconnect counts against the hourly limit. Tested: with the default a connection was closed within 30 idle seconds; with the session setting it stayed open. |
| Statement time limit (`MAX_STATEMENT_TIME`) | 120 seconds | The lock wait is 100 seconds, so a long wait ends as a lock timeout, which `withTransaction` retries, and not as a killed statement. No statement the app runs should take anywhere near 120 seconds. |
| Default `sql_mode` | not strict | Each connection sets strict mode itself. |
| Default isolation | `READ-COMMITTED` | Same as the app sets. |
| Time zone | UTC | Each connection sets UTC itself anyway. |
| Database size cap | 3072 MB | Nothing yet. `llm_logs` and `turn_execution_manifests` have no retention policy. |
| Round trip from outside Hostinger | about 51 ms | Not relevant in production: the deployed app connects on `127.0.0.1`. |

The limits were read from a user allowed to connect from one outside address. A user created for the app on Hostinger itself may be given different numbers, so run `npm run db:probe` once on the production database too.

## History

The app ran on PostgreSQL until November 2026. The last Postgres dump is kept locally in `backups/` (not in git). Users, games and logs were not carried over; content was, through release v10.7.0.
