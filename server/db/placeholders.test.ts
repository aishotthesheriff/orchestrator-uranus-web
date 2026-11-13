import { describe, expect, it } from "vitest";
import { splitUpdateReturning, translatePlaceholders } from "./placeholders";
import { encodeParam, formatUtcDateTime, parseDatabaseUrl, parseUtcDateTime } from "./mariadbConfig";
import { splitStatements } from "./migrate";

describe("translatePlaceholders", () => {
  it("turns numbered placeholders into ? in order of appearance", () => {
    expect(translatePlaceholders("SELECT * FROM t WHERE a = $1 AND b = $2", ["x", 2])).toEqual({
      sql: "SELECT * FROM t WHERE a = ? AND b = ?",
      values: ["x", 2],
    });
  });

  it("repeats and reorders values when a number is reused or out of order", () => {
    const { sql, values } = translatePlaceholders(
      "SELECT COUNT(CASE WHEN run_at <= $2 THEN 1 END), MIN(CASE WHEN run_at > $2 THEN 1 END) FROM q WHERE queue = $1",
      ["image", "now"]
    );
    expect(sql).toBe("SELECT COUNT(CASE WHEN run_at <= ? THEN 1 END), MIN(CASE WHEN run_at > ? THEN 1 END) FROM q WHERE queue = ?");
    expect(values).toEqual(["now", "now", "image"]);
  });

  it("tells $1 from $10", () => {
    const params = Array.from({ length: 11 }, (_, i) => `v${i + 1}`);
    expect(translatePlaceholders("VALUES ($10, $1, $11)", params).values).toEqual(["v10", "v1", "v11"]);
  });

  it("leaves strings, quoted identifiers and comments alone", () => {
    const sql = "UPDATE m SET doc = JSON_SET(doc, '$.evals', JSON_QUERY($2, '$')), note = 'costs $1' /* $3 */ WHERE `key` = $1 -- $4";
    const translated = translatePlaceholders(sql, ["id", "{}"]);
    expect(translated.sql).toBe(
      "UPDATE m SET doc = JSON_SET(doc, '$.evals', JSON_QUERY(?, '$')), note = 'costs $1' /* $3 */ WHERE `key` = ? -- $4"
    );
    expect(translated.values).toEqual(["{}", "id"]);
  });

  it("handles escaped quotes inside strings", () => {
    const translated = translatePlaceholders("SELECT 'it''s $1', 'a\\'b $2', $1", ["x"]);
    expect(translated.sql).toBe("SELECT 'it''s $1', 'a\\'b $2', ?");
    expect(translated.values).toEqual(["x"]);
  });

  it("refuses a placeholder with no value", () => {
    expect(() => translatePlaceholders("SELECT $2", ["only one"])).toThrow("$2");
  });

  it("passes through statements already written with ?", () => {
    expect(translatePlaceholders("SELECT ?", [1])).toEqual({ sql: "SELECT ?", values: [1] });
  });
});

describe("splitUpdateReturning", () => {
  it("ignores statements that are not UPDATE ... RETURNING", () => {
    expect(splitUpdateReturning("SELECT 1")).toBeNull();
    expect(splitUpdateReturning("UPDATE t SET a = $1 WHERE id = $2")).toBeNull();
    expect(splitUpdateReturning("INSERT INTO t (a) VALUES ($1) RETURNING *")).toBeNull();
  });

  it("splits the supported shape into an update and a read-back by the same key", () => {
    expect(
      splitUpdateReturning(`UPDATE events
         SET name = $1, tags = $2, updated_at = NOW(3)
         WHERE id = $3
         RETURNING *`)
    ).toEqual({
      updateSql: "UPDATE events SET name = $1, tags = $2, updated_at = NOW(3) WHERE id = $3",
      selectSql: "SELECT * FROM events WHERE id = $3",
    });
  });

  it("supports a quoted key column and a key that is not the last parameter", () => {
    expect(splitUpdateReturning("UPDATE app_settings SET value = $1 WHERE `key` = $2 RETURNING *")?.selectSql).toBe(
      "SELECT * FROM app_settings WHERE `key` = $2"
    );
    expect(splitUpdateReturning("UPDATE e SET status = $2, name = COALESCE($3, name) WHERE id = $1 RETURNING *")?.selectSql).toBe(
      "SELECT * FROM e WHERE id = $1"
    );
  });

  it("refuses shapes it could read back wrongly", () => {
    expect(() => splitUpdateReturning("UPDATE t SET a = 1 WHERE status = 'pending' AND x = $1 RETURNING *")).toThrow("only supported");
    expect(() => splitUpdateReturning("UPDATE t SET a = 1 WHERE id = $1 RETURNING id")).toThrow("only supported");
    expect(() => splitUpdateReturning("UPDATE t SET id = $1 WHERE id = $2 RETURNING *")).toThrow("key column");
  });
});

describe("dates and parameters", () => {
  it("writes and reads timestamps as UTC whatever the process time zone is", () => {
    const date = new Date("2026-11-13T10:20:30.123Z");
    expect(formatUtcDateTime(date)).toBe("2026-11-13 10:20:30.123");
    expect(parseUtcDateTime("2026-11-13 10:20:30.123")?.getTime()).toBe(date.getTime());
    expect(parseUtcDateTime("2026-11-13 10:20:30")?.toISOString()).toBe("2026-11-13T10:20:30.000Z");
    expect(parseUtcDateTime("0000-00-00 00:00:00")).toBeNull();
  });

  it("encodes parameters the driver would otherwise mishandle", () => {
    expect(encodeParam(new Date("2026-01-02T03:04:05.006Z"))).toBe("2026-01-02 03:04:05.006");
    expect(encodeParam(undefined)).toBeNull();
    expect(encodeParam({ a: 1 })).toBe('{"a":1}');
    expect(encodeParam([1, 2])).toBe("[1,2]");
    const buffer = Buffer.from([1, 2]);
    expect(encodeParam(buffer)).toBe(buffer);
    expect(encodeParam("text")).toBe("text");
    expect(encodeParam(true)).toBe(true);
    expect(() => encodeParam(new Date("nope"))).toThrow("invalid Date");
  });
});

describe("parseDatabaseUrl", () => {
  it("reads mysql:// and mariadb:// URLs, decoding the user and password", () => {
    expect(parseDatabaseUrl("mysql://u123_app:p%40ss%2Fword@127.0.0.1:3306/u123_game")).toEqual({
      host: "127.0.0.1",
      port: 3306,
      user: "u123_app",
      password: "p@ss/word",
      database: "u123_game",
    });
    expect(parseDatabaseUrl("mariadb://a:b@db/game").port).toBe(3306);
  });

  it("explains what is wrong with other URLs", () => {
    expect(() => parseDatabaseUrl("postgresql://a:b@localhost:5432/game")).toThrow("MariaDB");
    expect(() => parseDatabaseUrl("mysql://a:b@localhost:3306/")).toThrow("no database name");
    expect(() => parseDatabaseUrl("not a url")).toThrow("not a valid URL");
  });
});

describe("splitStatements", () => {
  it("splits on a semicolon at the end of a line and drops comment lines", () => {
    const sql = "-- header; with a semicolon\nCREATE TABLE a (\n  x INT DEFAULT 1, -- inline; kept\n  y TEXT\n);\n\nCREATE TABLE b (z INT);\n";
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0].startsWith("CREATE TABLE a")).toBe(true);
    expect(statements[1]).toBe("CREATE TABLE b (z INT)");
  });
});
