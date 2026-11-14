/**
 * The database pool (MariaDB).
 *
 * The rest of the app talks to it through a small interface: `pool.query(sql, params)`
 * returns `{ rows, rowCount }`, and `pool.connect()` hands out one connection for a
 * transaction (`BEGIN` / `COMMIT` / `ROLLBACK` are plain statements). SQL is written with
 * numbered placeholders ($1, $2, ...); see ./db/placeholders.
 */
import * as mariadb from "mariadb";
import { connectionOptions, encodeParam, parseDatabaseUrl, POOL_IDLE_TIMEOUT_SECONDS } from "./db/mariadbConfig";
import { splitUpdateReturning, translatePlaceholders } from "./db/placeholders";
import { isRetryableLockError } from "./db/errors";

export interface QueryResult<Row = any> {
  rows: Row[];
  /** Rows returned, or for a write without RETURNING, rows matched. */
  rowCount: number;
}

export interface Queryable {
  query<Row = any>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export interface DbClient extends Queryable {
  /** Gives the connection back. An unfinished transaction is rolled back. */
  release(): void;
}

export interface DbPool extends Queryable {
  connect(): Promise<DbClient>;
  end(): Promise<void>;
}

type RawConnection = { query(sql: string, values?: unknown[]): Promise<any> };

async function runOne<Row>(conn: RawConnection, sql: string, params: readonly unknown[]): Promise<QueryResult<Row>> {
  const translated = translatePlaceholders(sql, params);
  const result = await conn.query(translated.sql, translated.values.map(encodeParam));
  if (Array.isArray(result)) {
    // A plain array, without the driver's `meta` property
    return { rows: Array.from(result) as Row[], rowCount: result.length };
  }
  return { rows: [], rowCount: Number(result?.affectedRows ?? 0) };
}

async function run<Row>(conn: RawConnection, sql: string, params: readonly unknown[] = []): Promise<QueryResult<Row>> {
  const split = splitUpdateReturning(sql);
  if (!split) return runOne<Row>(conn, sql, params);
  await runOne(conn, split.updateSql, params);
  return runOne<Row>(conn, split.selectSql, params);
}

/** The database the pool connects to. Tests get their own, so they can never touch game data. */
function resolveDatabaseUrl(): string {
  if (process.env.VITEST) {
    const testUrl = process.env.DATABASE_URL_TEST;
    if (!testUrl) {
      throw new Error(
        "DATABASE_URL_TEST must be set to run tests that use the database " +
          "(e.g. mysql://uranus:password@localhost:3306/uranus_dungeon_test). DATABASE_URL is never used by tests."
      );
    }
    if (!parseDatabaseUrl(testUrl).database.endsWith("_test")) {
      throw new Error("DATABASE_URL_TEST must point at a database whose name ends in _test");
    }
    return testUrl;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }
  return url;
}

let rawPool: mariadb.Pool | null = null;

/** The most connections the pool opens. Set DB_POOL_MAX below the host's per-user connection cap. */
export function poolLimit(): number {
  return Math.max(2, Number(process.env.DB_POOL_MAX) || 20);
}

/**
 * Lets at most `max` callers run at a time; the rest wait their turn.
 * `acquire()` resolves with a function that gives the slot back.
 */
export function createLimiter(max: number): { acquire(): Promise<() => void> } {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return {
    acquire() {
      if (active < max) {
        active++;
        return Promise.resolve(release);
      }
      return new Promise((resolve) => waiting.push(() => resolve(release)));
    },
  };
}

/** Created on first use, so code that never queries (unit tests, type checks) needs no database. */
function getRawPool(): mariadb.Pool {
  if (!rawPool) {
    const limit = poolLimit();
    rawPool = mariadb.createPool({
      ...connectionOptions(resolveDatabaseUrl()),
      connectionLimit: limit,
      // Keep a couple of connections warm; close the rest when idle (shared hosts cap connections).
      // Spare connections are kept for ten minutes, not one: Hostinger also caps how many new
      // connections a user may open per hour (500), so reconnecting after every burst is costly.
      minimumIdle: Math.min(2, limit),
      idleTimeout: POOL_IDLE_TIMEOUT_SECONDS,
      // A turn can hold a connection while a story is generated, so waiting briefly is normal.
      acquireTimeout: 15000,
      keepAliveDelay: 30000,
    });
    rawPool.on("error", (error) => {
      console.error("[db] pool error:", error?.message ?? error);
    });
  }
  return rawPool;
}

export const pool: DbPool = {
  async query<Row = any>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>> {
    // UPDATE ... RETURNING is two statements and needs one connection for both.
    if (/^\s*UPDATE\b/i.test(sql) && /\bRETURNING\b/i.test(sql)) {
      const conn = await getRawPool().getConnection();
      try {
        return await run<Row>(conn, sql, params);
      } finally {
        await conn.release();
      }
    }
    return run<Row>(getRawPool(), sql, params);
  },

  async connect(): Promise<DbClient> {
    const conn = await getRawPool().getConnection();
    let released = false;
    return {
      query: <Row = any>(sql: string, params?: readonly unknown[]) => run<Row>(conn, sql, params),
      release() {
        if (released) return;
        released = true;
        // The pool rolls back any open transaction before reusing the connection.
        void conn.release();
      },
    };
  },

  async end(): Promise<void> {
    if (rawPool) {
      const closing = rawPool;
      rawPool = null;
      await closing.end();
    }
  },
};

export interface TransactionOptions {
  /** How many times to run again after a deadlock or lock wait timeout. Default 3. */
  retries?: number;
}

/**
 * Runs `fn` in a transaction. Commits when it resolves, rolls back when it throws.
 * InnoDB resolves a deadlock by rolling one transaction back; that transaction is simply
 * run again here, so `fn` must not have effects outside the database.
 */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (attempt < retries && isRetryableLockError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1) + Math.random() * 30));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
