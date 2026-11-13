/**
 * MariaDB error numbers the app reacts to. Use these helpers instead of comparing codes
 * at the call site.
 */

function errno(error: unknown): number | undefined {
  return typeof error === "object" && error !== null ? (error as { errno?: number }).errno : undefined;
}

/** A row with the same unique key already exists (ER_DUP_ENTRY). */
export function isUniqueViolation(error: unknown): boolean {
  return errno(error) === 1062;
}

/** The table does not exist (ER_NO_SUCH_TABLE): the schema has not been created. */
export function isMissingTable(error: unknown): boolean {
  return errno(error) === 1146;
}

/** The table name from a missing-table error, e.g. "users". */
export function missingTableName(error: unknown): string | undefined {
  const message = (error as { sqlMessage?: string; message?: string })?.sqlMessage ?? (error as Error)?.message ?? "";
  return message.match(/Table '(?:[^'.]+\.)?([^']+)' doesn't exist/)?.[1];
}

/**
 * InnoDB gave up on this transaction because of a deadlock (1213) or a lock wait that
 * timed out (1205). The transaction was rolled back and is safe to run again.
 */
export function isRetryableLockError(error: unknown): boolean {
  const code = errno(error);
  return code === 1213 || code === 1205;
}
