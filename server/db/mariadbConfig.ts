/**
 * Connection settings for MariaDB, shared by the app's pool and the command-line scripts,
 * so a script never talks to the database with different type handling than the app.
 */
import type { PoolConfig, TypeCastFunction } from "mariadb";

export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Parses `mysql://user:password@host:port/database` (what Hostinger writes) or the same
 * with `mariadb://`. User and password may be percent-encoded.
 */
export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL (expected mysql://user:password@host:3306/database)");
  }
  if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
    throw new Error(
      `DATABASE_URL must start with mysql:// or mariadb:// (got ${parsed.protocol}//). This app runs on MariaDB.`
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("DATABASE_URL has no database name (expected mysql://user:password@host:3306/database)");
  }
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

/**
 * Timestamps are UTC in the database. The driver itself always converts with the Node
 * process's own time zone (its `timezone` option only changes the server session), which
 * would shift every value by the host's UTC offset. So dates are converted here instead:
 * the result does not depend on where the app runs.
 */
export function parseUtcDateTime(text: string): Date | null {
  // 'YYYY-MM-DD HH:MM:SS[.fff]'; MariaDB's zero date means "no value".
  if (text.startsWith("0000-00-00")) return null;
  return new Date(`${text.replace(" ", "T")}Z`);
}

/** A Date as a UTC 'YYYY-MM-DD HH:MM:SS.mmm' literal. */
export function formatUtcDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("Cannot send an invalid Date to the database");
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Converts a query parameter to what the driver should send:
 * - Dates become UTC literals.
 * - `undefined` becomes NULL.
 * - Plain objects and arrays become JSON text (they are only ever bound to JSON columns).
 * Strings, numbers, booleans, null and Buffers pass through.
 */
export function encodeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return formatUtcDateTime(value);
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) return JSON.stringify(value);
  return value;
}

/**
 * Column decoding that differs from the driver's defaults:
 * - DATETIME and TIMESTAMP are read as UTC (see parseUtcDateTime).
 * - BOOLEAN columns are TINYINT(1) and would arrive as 0/1. The app compares some of them
 *   with `=== false`, so they are returned as real booleans.
 */
export const typeCast: TypeCastFunction = (column, next) => {
  switch (column.type) {
    case "DATETIME":
    case "DATETIME2":
    case "TIMESTAMP":
    case "TIMESTAMP2": {
      const text = column.string();
      return text === null ? null : parseUtcDateTime(text);
    }
    case "TINY":
      if (column.columnLength === 1) {
        const value = column.tiny();
        return value === null ? null : value !== 0;
      }
      return next();
    default:
      return next();
  }
};

/** Statements run on every new connection, in order. */
export const SESSION_INIT_SQL: readonly string[] = [
  // All timestamps are stored and compared in UTC, whatever the server's own zone is.
  "SET time_zone = '+00:00'",
  // Postgres's default. Avoids InnoDB gap locks, which would make queue claims block inserts.
  "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
  // Reject bad data (too long, wrong type) instead of silently truncating it.
  "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
  // A turn's row lock can be held while a story is generated; wait for it rather than fail at 50s.
  "SET SESSION innodb_lock_wait_timeout = 120",
];

/** Driver options that decide how values travel between JavaScript and MariaDB. */
export function connectionOptions(url: string): PoolConfig {
  return {
    ...parseDatabaseUrl(url),
    charset: "utf8mb4",
    // Dates are converted by typeCast and encodeParam, not by the driver (see parseUtcDateTime).
    // COUNT(*) and BIGINT as plain numbers; DECIMAL stays a string so prices keep their digits.
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    decimalAsNumber: false,
    // JSON columns arrive parsed (the server marks them in the column metadata).
    autoJsonMap: true,
    // `SELECT a.*, b.*` with a shared column name is allowed; the later column wins, as with pg.
    checkDuplicate: false,
    typeCast,
    initSql: [...SESSION_INIT_SQL],
  };
}
