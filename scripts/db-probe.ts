/**
 * Checks whether a MariaDB server can run this app, before anything is installed on it.
 *
 * It reports the server's version and limits, then tries every database feature the app
 * relies on in throwaway tables named zz_probe_* (dropped at the end). Nothing else in the
 * database is read or changed.
 *
 * Usage:
 *   DATABASE_URL=mysql://user:password@host:3306/database npx tsx scripts/db-probe.ts
 *   npx tsx scripts/db-probe.ts --out probe.json     (also writes the results as JSON)
 *
 * Exit code 0: the server qualifies. 1: it does not (the failed checks are listed).
 */
import { writeFileSync } from "fs";
import * as mariadb from "mariadb";
import { connectionOptions, encodeParam, parseDatabaseUrl, SESSION_INIT_SQL } from "../server/db/mariadbConfig";

const MIN_VERSION = [10, 6] as const;
const MIN_PACKET_BYTES = 16 * 1024 * 1024;

interface Check {
  name: string;
  ok: boolean;
  /** True when a failure means the app cannot run here. */
  required: boolean;
  detail: string;
}

const checks: Check[] = [];

async function check(name: string, required: boolean, fn: () => Promise<string>): Promise<void> {
  try {
    checks.push({ name, ok: true, required, detail: await fn() });
  } catch (error: any) {
    const code = error?.errno ? ` [errno ${error.errno}]` : "";
    checks.push({ name, ok: false, required, detail: `${error?.sqlMessage ?? error?.message ?? String(error)}${code}` });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set (mysql://user:password@host:3306/database).");
    process.exit(1);
  }
  const outIndex = process.argv.indexOf("--out");
  const outFile = outIndex > -1 ? process.argv[outIndex + 1] : undefined;
  const target = parseDatabaseUrl(url);
  console.log(`Probing ${target.host}:${target.port}/${target.database} as ${target.user}\n`);

  // A bare connection first: it shows the server's own defaults, before the app's session setup.
  const bare = await mariadb.createConnection({ ...connectionOptions(url), initSql: undefined });
  const [vars] = await bare.query(
    `SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@tx_isolation AS isolation,
            @@max_allowed_packet AS max_allowed_packet, @@max_connections AS max_connections,
            @@max_user_connections AS max_user_connections, @@wait_timeout AS wait_timeout,
            @@innodb_lock_wait_timeout AS innodb_lock_wait_timeout, @@time_zone AS time_zone,
            @@system_time_zone AS system_time_zone, @@character_set_server AS charset,
            @@collation_server AS collation, @@lower_case_table_names AS lower_case_table_names,
            @@default_storage_engine AS storage_engine`
  );
  const grants: string[] = (await bare.query({ sql: "SHOW GRANTS", rowsAsArray: true })).map((row: any[]) =>
    String(row[0]).replace(/IDENTIFIED BY PASSWORD '[^']*'/g, "IDENTIFIED BY PASSWORD '<hidden>'")
  );
  await bare.end();

  const version = String(vars.version);
  const isMariaDb = /mariadb/i.test(version);
  // Some servers report "5.5.5-10.6.x-MariaDB"; the real version is the last x.y.z before "-MariaDB".
  const match = version.match(/(\d+)\.(\d+)\.(\d+)(?=-MariaDB)/i) ?? version.match(/(\d+)\.(\d+)\.(\d+)/);
  const [major, minor] = match ? [Number(match[1]), Number(match[2])] : [0, 0];

  await check("Server is MariaDB", true, async () => {
    assert(isMariaDb, `VERSION() is '${version}'. MySQL is not supported (no INSERT ... RETURNING).`);
    return version;
  });
  await check(`Version is ${MIN_VERSION.join(".")} or later`, true, async () => {
    assert(
      major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]),
      `Found ${major}.${minor}. FOR UPDATE SKIP LOCKED needs 10.6.`
    );
    return `${major}.${minor}`;
  });
  await check("max_allowed_packet is at least 16 MB", true, async () => {
    const bytes = Number(vars.max_allowed_packet);
    assert(bytes >= MIN_PACKET_BYTES, `Found ${(bytes / 1048576).toFixed(1)} MB. A finished game's state can exceed this.`);
    return `${(bytes / 1048576).toFixed(0)} MB`;
  });

  // From here on, connections are set up exactly as the app sets them up.
  const pool = mariadb.createPool({ ...connectionOptions(url), connectionLimit: 3, initSql: undefined });
  const conn = await pool.getConnection();

  for (const sql of SESSION_INIT_SQL) {
    await check(`Session setting allowed: ${sql.replace(/^SET (SESSION )?/, "").slice(0, 60)}`, true, async () => {
      await conn.query(sql);
      return "ok";
    });
  }

  const drop = async () => {
    await conn.query("DROP TABLE IF EXISTS zz_probe_child");
    await conn.query("DROP TABLE IF EXISTS zz_probe_parent");
  };

  await check("Create tables with every column type the app uses", true, async () => {
    await drop();
    await conn.query(`
      CREATE TABLE zz_probe_parent (
        id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        username VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
        label VARCHAR(128) NOT NULL DEFAULT '',
        body MEDIUMTEXT NULL,
        doc JSON NULL,
        flag BOOLEAN NOT NULL DEFAULT FALSE,
        nullable_flag BOOLEAN NULL,
        count_col INT NOT NULL DEFAULT 0,
        price DECIMAL(12,6) NULL,
        ratio DOUBLE NULL,
        hash VARBINARY(32) NULL,
        status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending',
        slot_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL DEFAULT 'a',
        created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        active_slot VARCHAR(140) COLLATE utf8mb4_bin
          AS (CASE WHEN status IN ('pending','processing') THEN CONCAT(slot_key, ':', count_col) END) STORED,
        UNIQUE KEY uq_probe_username (username),
        UNIQUE KEY uq_probe_active_slot (active_slot),
        KEY idx_probe_status_created (status, created_at),
        CONSTRAINT chk_probe_count CHECK (count_col >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`
      CREATE TABLE zz_probe_child (
        id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        parent_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
        CONSTRAINT fk_probe_child_parent FOREIGN KEY (parent_id) REFERENCES zz_probe_parent (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    return "JSON, DATETIME(3), BOOLEAN, VARBINARY, DECIMAL, stored generated column, CHECK, foreign key";
  });

  const when = new Date("2026-11-13T10:20:30.123Z");
  const docValue = { turns: [{ n: 1, text: "Launch 🚀" }], nested: { ok: true, none: null } };

  await check("INSERT ... RETURNING", true, async () => {
    const rows = await conn.query(
      `INSERT INTO zz_probe_parent (id, username, label, body, doc, flag, nullable_flag, count_col, price, ratio, hash, slot_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ["p1", "Joey", "Fresh Start 🚀", "x", JSON.stringify(docValue), true, null, 1, "0.150000", 0.25, Buffer.alloc(0), "g1", when].map(encodeParam)
    );
    assert(rows.length === 1 && rows[0].id === "p1", "No row came back");
    return "ok";
  });

  await check("Values come back in the types the app expects", true, async () => {
    const [row] = await conn.query("SELECT * FROM zz_probe_parent WHERE id = ?", ["p1"]);
    const problems: string[] = [];
    if (typeof row.doc !== "object" || row.doc?.turns?.[0]?.text !== "Launch 🚀") problems.push(`JSON arrived as ${typeof row.doc}`);
    if (row.flag !== true) problems.push(`BOOLEAN true arrived as ${JSON.stringify(row.flag)}`);
    if (row.nullable_flag !== null) problems.push(`NULL BOOLEAN arrived as ${JSON.stringify(row.nullable_flag)}`);
    if (!(row.created_at instanceof Date) || row.created_at.getTime() !== when.getTime())
      problems.push(`DATETIME(3) arrived as ${row.created_at instanceof Date ? row.created_at.toISOString() : typeof row.created_at}`);
    if (!Buffer.isBuffer(row.hash) || row.hash.length !== 0) problems.push(`empty VARBINARY arrived as ${JSON.stringify(row.hash)}`);
    if (row.price !== "0.150000") problems.push(`DECIMAL arrived as ${JSON.stringify(row.price)}`);
    if (row.label !== "Fresh Start 🚀") problems.push("emoji text was changed");
    if (row.count_col !== 1) problems.push(`INT arrived as ${typeof row.count_col}`);
    const [agg] = await conn.query(
      "SELECT COUNT(*) AS n, NOW(3) AS now3, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS stored FROM zz_probe_parent"
    );
    if (agg.n !== 1) problems.push(`COUNT(*) arrived as ${typeof agg.n}`);
    if (agg.stored !== "2026-11-13 10:20:30.123000") problems.push(`the date was stored as '${agg.stored}', not as UTC`);
    if (!(agg.now3 instanceof Date)) problems.push("NOW(3) is not a Date");
    else if (Math.abs(agg.now3.getTime() - Date.now()) > 5 * 60 * 1000)
      problems.push(`server clock or time zone is off by ${Math.round((agg.now3.getTime() - Date.now()) / 60000)} minutes`);
    assert(problems.length === 0, problems.join("; "));
    return "JSON parsed, booleans, UTC dates to the millisecond, empty binary, decimal string, emoji, numeric counts";
  });

  await check("Text matching is case-sensitive where the app needs it", true, async () => {
    const rows = await conn.query("SELECT id FROM zz_probe_parent WHERE username = ?", ["joey"]);
    assert(rows.length === 0, "'joey' matched the user 'Joey'");
    await conn.query(
      "INSERT INTO zz_probe_parent (id, username, count_col, slot_key) VALUES (?, ?, ?, ?)",
      ["p2", "joey", 2, "g1"]
    );
    return "'Joey' and 'joey' are different users";
  });

  await check("At most one active row per slot (unique index on a generated column)", true, async () => {
    // p1 holds slot g1:1 while pending. A second pending row for the same slot must be refused.
    let refused = false;
    try {
      await conn.query(
        "INSERT INTO zz_probe_parent (id, username, count_col, slot_key) VALUES (?, ?, ?, ?)",
        ["p3", "third", 1, "g1"]
      );
    } catch (error: any) {
      refused = error?.errno === 1062;
      if (!refused) throw error;
    }
    assert(refused, "A duplicate active row was accepted");
    // Once the first is completed, the slot is free again, and finished rows never collide.
    await conn.query("UPDATE zz_probe_parent SET status = 'completed' WHERE id = ?", ["p1"]);
    await conn.query(
      "INSERT INTO zz_probe_parent (id, username, count_col, slot_key, status) VALUES (?, ?, ?, ?, 'completed')",
      ["p3", "third", 1, "g1"]
    );
    await conn.query(
      "INSERT INTO zz_probe_parent (id, username, count_col, slot_key) VALUES (?, ?, ?, ?)",
      ["p4", "fourth", 1, "g1"]
    );
    return "duplicate refused with errno 1062; completed rows do not collide";
  });

  await check("CHECK constraints are enforced", true, async () => {
    try {
      await conn.query("UPDATE zz_probe_parent SET count_col = -1 WHERE id = ?", ["p2"]);
    } catch (error: any) {
      return `refused [errno ${error?.errno}]`;
    }
    throw new Error("A value that breaks the CHECK was accepted");
  });

  await check("Strict mode refuses text that is too long", true, async () => {
    try {
      await conn.query("UPDATE zz_probe_parent SET status = ? WHERE id = ?", ["x".repeat(40), "p2"]);
    } catch (error: any) {
      return `refused [errno ${error?.errno}]`;
    }
    throw new Error("Over-long text was silently truncated");
  });

  await check("FOR UPDATE SKIP LOCKED (job queue claims)", true, async () => {
    const other = await pool.getConnection();
    try {
      for (const sql of SESSION_INIT_SQL) await other.query(sql);
      await conn.query("BEGIN");
      const held = await conn.query("SELECT id FROM zz_probe_parent WHERE id = ? FOR UPDATE", ["p2"]);
      assert(held.length === 1, "Could not lock a row");
      await other.query("BEGIN");
      const started = Date.now();
      const rows = await other.query(
        "SELECT id FROM zz_probe_parent WHERE id IN (?, ?) ORDER BY id FOR UPDATE SKIP LOCKED",
        ["p2", "p4"]
      );
      const waited = Date.now() - started;
      await other.query("ROLLBACK");
      await conn.query("ROLLBACK");
      assert(rows.length === 1 && rows[0].id === "p4", `Expected only the unlocked row, got ${JSON.stringify(rows)}`);
      assert(waited < 2000, `The query waited ${waited} ms for the lock`);
      return `locked row skipped in ${waited} ms`;
    } finally {
      await other.release();
    }
  });

  await check("Transactions roll back", true, async () => {
    await conn.query("BEGIN");
    await conn.query("UPDATE zz_probe_parent SET label = 'changed' WHERE id = ?", ["p2"]);
    await conn.query("ROLLBACK");
    const [row] = await conn.query("SELECT label FROM zz_probe_parent WHERE id = ?", ["p2"]);
    assert(row.label === "", "The change survived a ROLLBACK");
    return "ok";
  });

  await check("Foreign key with ON DELETE CASCADE, and DELETE ... RETURNING", true, async () => {
    await conn.query("INSERT INTO zz_probe_child (id, parent_id) VALUES (?, ?)", ["c1", "p4"]);
    const deleted = await conn.query("DELETE FROM zz_probe_parent WHERE id = ? RETURNING id", ["p4"]);
    assert(deleted.length === 1 && deleted[0].id === "p4", "DELETE ... RETURNING returned nothing");
    const [left] = await conn.query("SELECT COUNT(*) AS n FROM zz_probe_child");
    assert(left.n === 0, "The child row was not removed");
    return "ok";
  });

  await check("An 8 MB value can be stored and read back", true, async () => {
    const big = "y".repeat(8 * 1024 * 1024);
    await conn.query("UPDATE zz_probe_parent SET body = ? WHERE id = ?", [big, "p2"]);
    const [row] = await conn.query("SELECT CHAR_LENGTH(body) AS n FROM zz_probe_parent WHERE id = ?", ["p2"]);
    assert(row.n === big.length, `Stored ${row.n} of ${big.length} characters`);
    await conn.query("UPDATE zz_probe_parent SET body = NULL WHERE id = ?", ["p2"]);
    return "ok";
  });

  let medianMs = 0;
  await check("Round-trip time for one query", false, async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = process.hrtime.bigint();
      await conn.query("SELECT 1");
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    times.sort((a, b) => a - b);
    medianMs = times[10];
    return `median ${medianMs.toFixed(1)} ms over 20 queries`;
  });

  await check("Clean up probe tables", false, async () => {
    await drop();
    return "dropped";
  });

  await conn.release();
  await pool.end();

  // Report
  const server = {
    version,
    sqlMode: vars.sql_mode,
    isolation: vars.isolation,
    maxAllowedPacketMb: Number(vars.max_allowed_packet) / 1048576,
    maxConnections: Number(vars.max_connections),
    maxUserConnections: Number(vars.max_user_connections),
    waitTimeoutSeconds: Number(vars.wait_timeout),
    innodbLockWaitTimeoutSeconds: Number(vars.innodb_lock_wait_timeout),
    timeZone: `${vars.time_zone} (system: ${vars.system_time_zone})`,
    charset: vars.charset,
    collation: vars.collation,
    lowerCaseTableNames: Number(vars.lower_case_table_names),
    storageEngine: vars.storage_engine,
  };
  console.log("Server");
  for (const [key, value] of Object.entries(server)) console.log(`  ${key}: ${value}`);
  console.log("\nGrants");
  for (const grant of grants) console.log(`  ${grant}`);
  console.log("\nChecks");
  for (const c of checks) {
    const mark = c.ok ? "PASS" : c.required ? "FAIL" : "WARN";
    console.log(`  ${mark}  ${c.name}: ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.ok && c.required);
  const qualifies = failed.length === 0;
  console.log(
    qualifies
      ? `\nResult: this server can run the app (${checks.filter((c) => c.ok).length} of ${checks.length} checks passed).`
      : `\nResult: this server CANNOT run the app. Failed: ${failed.map((c) => c.name).join("; ")}`
  );
  if (server.maxUserConnections > 0) {
    console.log(`Note: this user may open at most ${server.maxUserConnections} connections; set DB_POOL_MAX below that.`);
  }

  if (outFile) {
    writeFileSync(
      outFile,
      JSON.stringify({ probedAt: new Date().toISOString(), host: target.host, qualifies, server, grants, checks, medianMs }, null, 2)
    );
    console.log(`Results written to ${outFile}`);
  }
  process.exit(qualifies ? 0 : 1);
}

main().catch((error) => {
  console.error(`Probe could not run: ${error?.sqlMessage ?? error?.message ?? error}`);
  process.exit(1);
});
