/**
 * The app's SQL is written with numbered placeholders ($1, $2, ...). MariaDB takes
 * positional `?` placeholders, so each statement is translated just before it is sent:
 * every $N becomes `?` and the values are laid out in the order the placeholders appear.
 * A number may be used more than once, or out of order.
 *
 * Quoted strings, quoted identifiers and comments are left alone, so a `$1` inside a
 * string literal (or a JSON path such as '$.evals') is not treated as a placeholder.
 */

export interface TranslatedQuery {
  sql: string;
  values: unknown[];
}

export function translatePlaceholders(sql: string, params: readonly unknown[] = []): TranslatedQuery {
  let out = "";
  const values: unknown[] = [];
  let numbered = false;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];

    // Quoted string or identifier: copy through to the closing quote
    if (ch === "'" || ch === '"' || ch === "`") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "\\" && ch !== "`") {
          i += 2;
          continue;
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2; // doubled quote is an escaped quote
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }

    // -- comment to end of line
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === "$" && sql[i + 1] >= "0" && sql[i + 1] <= "9") {
      let j = i + 1;
      while (j < n && sql[j] >= "0" && sql[j] <= "9") j++;
      const index = Number(sql.slice(i + 1, j));
      if (index < 1 || index > params.length) {
        throw new Error(`SQL uses $${index} but ${params.length} parameter(s) were given`);
      }
      values.push(params[index - 1]);
      out += "?";
      numbered = true;
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  // A statement already written with `?` is passed through unchanged.
  return numbered ? { sql: out, values } : { sql, values: [...params] };
}

export interface UpdateReturning {
  /** The UPDATE without its RETURNING clause. */
  updateSql: string;
  /** Reads the updated row back by the same key. */
  selectSql: string;
}

/**
 * MariaDB has no `UPDATE ... RETURNING`. The app uses it in one shape only:
 *
 *   UPDATE table SET ... WHERE key_column = $N RETURNING *
 *
 * That shape is run as the UPDATE followed by `SELECT * FROM table WHERE key_column = $N`.
 * It is correct only because the key column is never among the columns being set. Any
 * other shape (a compound WHERE, a column list after RETURNING) is refused, so a new query
 * cannot silently read back the wrong rows.
 *
 * Returns null when the statement is not an UPDATE ... RETURNING.
 */
export function splitUpdateReturning(sql: string): UpdateReturning | null {
  if (!/^\s*UPDATE\b/i.test(sql) || !/\bRETURNING\b/i.test(sql)) return null;

  const match = sql.match(
    /^\s*UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+([\s\S]+?)\s+WHERE\s+(`?[A-Za-z_][A-Za-z0-9_]*`?)\s*=\s*(\$\d+)\s+RETURNING\s+\*\s*;?\s*$/i
  );
  if (!match) {
    throw new Error(
      "UPDATE ... RETURNING is only supported as `UPDATE t SET ... WHERE key = $N RETURNING *` on MariaDB. " +
        "Run the UPDATE and a SELECT separately for anything else."
    );
  }
  const [, table, setClause, keyColumn, keyParam] = match;
  const bareKey = keyColumn.replace(/`/g, "");
  if (new RegExp(`(^|,)\\s*\`?${bareKey}\`?\\s*=`, "i").test(setClause)) {
    throw new Error(`UPDATE ... RETURNING cannot change its own key column (${bareKey})`);
  }
  return {
    updateSql: `UPDATE ${table} SET ${setClause} WHERE ${keyColumn} = ${keyParam}`,
    selectSql: `SELECT * FROM ${table} WHERE ${keyColumn} = ${keyParam}`,
  };
}
