/**
 * Turning a model's reply into the JSON object a story stage needs.
 *
 * Models without a JSON mode write good content but often get the envelope wrong: a code
 * fence around the object, a missing closing brace, an unquoted string. `recoverStageOutput`
 * tries progressively more forgiving readings and reports which one worked:
 *
 *   raw        parses as-is
 *   extracted  parses after removing a code fence or surrounding prose
 *   repaired   parses after closing an unfinished string/object/array, or escaping raw
 *              line breaks inside strings
 *   salvaged   narrative stage only: the narration text was lifted out of broken JSON
 *   failed     nothing usable
 *
 * Nothing here throws except `parseStageJson`, which is the stage runners' entry point.
 */

export type JsonQuality = "raw" | "extracted" | "repaired" | "salvaged" | "failed";

export interface JsonDiagnosis {
  quality: JsonQuality;
  /** The parsed value, unless quality is "failed". */
  value?: unknown;
  error?: string;
}

export interface StageOutputHints {
  /** Enables stage-specific recovery (narration salvage for "narrative"). */
  stage?: string;
  /**
   * Why the model stopped. "stop" (or leaving this undefined) allows repair. "length"
   * means the reply was cut off at the token limit; null means the provider did not say.
   */
  finishReason?: string | null;
}

/** Shortest narration worth salvaging; anything shorter is more likely debris than a scene. */
const MIN_SALVAGED_NARRATION_CHARS = 40;

function tryParseObject(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object") {
      return { ok: false, error: "Parsed, but the result is not an object or array" };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Fields that identify each stage's object: it must carry at least one of them. Used to
 * tell the real output from a stray example object or a fragment of a broken reply.
 * (The master sections are the ones flattenMasterEnrichment reads.)
 */
export const STAGE_OBJECT_KEYS: Record<string, readonly string[]> = {
  master: ["context", "variables", "guidance"],
  narrative: ["narration"],
  image: ["imagePrompt"],
  actions: ["actions"],
};

/** How many candidate blocks to consider. Far more than any sane reply contains. */
const MAX_OBJECT_STARTS = 60;

/**
 * Every "{" in the text as a possible start of the object, nested ones included. Only
 * safe when candidates are then checked against the stage's fields (STAGE_OBJECT_KEYS).
 */
function allBlocks(text: string): Array<{ start: number; end: number | null }> {
  const blocks: Array<{ start: number; end: number | null }> = [];
  for (let i = text.indexOf("{"); i !== -1 && blocks.length < MAX_OBJECT_STARTS; i = text.indexOf("{", i + 1)) {
    blocks.push({ start: i, end: balancedEnd(text, i) });
  }
  return blocks;
}

/**
 * The {...} blocks that sit at the top level of the text, in order. `end` is null for a
 * block that never closes (it then swallows the rest of the text). Braces nested inside
 * a block are part of it, not blocks of their own.
 */
function topLevelBlocks(text: string): Array<{ start: number; end: number | null }> {
  const blocks: Array<{ start: number; end: number | null }> = [];
  let from = 0;
  while (blocks.length < MAX_OBJECT_STARTS) {
    const start = text.indexOf("{", from);
    if (start === -1) break;
    const end = balancedEnd(text, start);
    blocks.push({ start, end });
    if (end === null) break;
    from = end;
  }
  return blocks;
}

/** End index (exclusive) of the balanced {...} block starting at `start`, honouring strings. */
function balancedEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/**
 * Finish JSON that stops early: close an open string, then any open objects and arrays.
 * Returns null when the text has no object, or nothing is left open (so there is nothing
 * this can fix). `from` selects which "{" to treat as the start of the object.
 */
export function closeUnfinishedJson(text: string, from = text.indexOf("{")): string | null {
  if (from < 0) return null;
  // Drop a trailing code fence so the closers land inside the object.
  const body = text.slice(from).replace(/```\s*$/, "").trimEnd();
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if ((ch === "}" || ch === "]") && closers.length > 0) closers.pop();
  }
  if (!inString && closers.length === 0) return null;
  // A lone trailing backslash would escape the quote we are about to add.
  const unescaped = inString && escaped ? body.slice(0, -1) : body;
  // A dangling comma before the closer ("..., }") is invalid JSON; remove it.
  const trimmed = inString ? unescaped : unescaped.replace(/,\s*$/, "");
  return trimmed + (inString ? '"' : "") + closers.reverse().join("");
}

/**
 * Escape raw control characters (line breaks, tabs) that a model typed inside a JSON
 * string. JSON forbids them there, and prose-minded models add them freely. Characters
 * outside strings are left alone: there they are ordinary whitespace.
 */
export function escapeControlCharsInStrings(text: string): string {
  const named: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch < " ") {
        out += named[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
    } else if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  return out;
}

/**
 * Lift the narration out of a narrative reply whose JSON is beyond repair, e.g.
 * `{"narration": Unquoted prose...}`. The narrative stage's output is essentially one
 * block of prose, so the text after `"narration":` is the content.
 */
export function salvageNarration(text: string): string | null {
  const key = text.match(/"narration"\s*:\s*/);
  if (!key || key.index === undefined) return null;
  let body = text.slice(key.index + key[0].length);
  // Stop where the next field begins (`, "someKey":`), if the model got that far.
  // Prose does not contain a comma followed by a quoted identifier and a colon.
  body = body.split(/\s*,\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:/)[0];
  body = body.replace(/```\s*$/, "").trim();
  body = body.replace(/\}\s*$/, "").trim().replace(/,\s*$/, "").trim();
  // Strip the string's own quotes. A model may also (wrongly) use single quotes.
  const quote = body.startsWith('"') ? '"' : body.startsWith("'") ? "'" : null;
  if (quote) {
    body = body.slice(1);
    if (body.endsWith(quote) && !body.endsWith(`\\${quote}`)) body = body.slice(0, -1);
  } else if (body.endsWith('"') && !body.endsWith('\\"') && (body.match(/"/g) ?? []).length % 2 === 1) {
    // An unquoted body that still ends in the closing quote the model added.
    body = body.slice(0, -1);
  }
  // A lone trailing backslash is half an escape sequence, not prose.
  body = body.replace(/(?<!\\)\\$/, "");
  let narration = body;
  if (quote === '"') {
    // The model was writing a JSON string: honour its escapes where they are valid.
    try {
      narration = JSON.parse(`"${body.replace(/\r?\n/g, "\\n")}"`);
    } catch {
      narration = body.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
  }
  narration = narration.trim();
  return narration.length >= MIN_SALVAGED_NARRATION_CHARS ? narration : null;
}

/**
 * Read a stage reply as generously as is safe.
 *
 * Repair and salvage are only applied when the model stopped on its own
 * (finish reason "stop", or not given to this function at all). They are never applied
 * to a reply that was cut off at the token limit ("length"), filtered, or whose finish
 * reason the provider did not report (null): closing a truncated object would silently
 * drop whatever the model had not written yet. Such a reply is only accepted if it
 * already contains a complete object, and then only if nothing else was begun after it.
 */
export function recoverStageOutput(rawText: string | null | undefined, hints: StageOutputHints = {}): JsonDiagnosis {
  const text = (rawText ?? "").trim();
  if (!text) return { quality: "failed", error: "The model returned an empty response" };

  const raw = tryParseObject(text);
  if (raw.ok) return { quality: "raw", value: raw.value };

  const stoppedNormally = hints.finishReason === undefined || hints.finishReason === "stop";
  const stageKeys = hints.stage ? STAGE_OBJECT_KEYS[hints.stage] : undefined;
  // A stray object (an example, a {placeholder}) or a fragment of a broken reply (one
  // section of the plan, one action) must not be mistaken for the stage's output.
  const isStageObject = (value: unknown) =>
    !stageKeys ||
    (typeof value === "object" && value !== null && !Array.isArray(value) && stageKeys.some((key) => key in value));
  // With the stage's fields known, every "{" can be tried: a fragment will not carry
  // them. Without, only top-level blocks are trusted, since nothing could tell a fragment
  // from the real object.
  const candidateBlocks = stageKeys ? allBlocks : topLevelBlocks;

  // 1. A complete object inside a ```json fence.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) {
    const parsed = tryParseObject(fence[1].trim());
    if (parsed.ok && isStageObject(parsed.value)) return { quality: "extracted", value: parsed.value };
  }

  // 2. A complete object anywhere in the text. Prose may contain braces of its own
  //    ("Here {is} the result: {...}"), so each candidate block is tried in turn.
  for (const { start, end } of candidateBlocks(text)) {
    if (end === null) continue; // never closes: not a complete object
    const parsed = tryParseObject(text.slice(start, end));
    if (!parsed.ok || !isStageObject(parsed.value)) continue;
    // If the model did not stop on its own and began another object afterwards, the one
    // we found may be a preamble and the real output the part that was cut off.
    if (!stoppedNormally && text.indexOf("{", end) !== -1) continue;
    return { quality: "extracted", value: parsed.value };
  }

  if (!stoppedNormally) {
    return {
      quality: "failed",
      error:
        hints.finishReason === "length"
          ? "The response was cut off at the token limit"
          : `The response is incomplete (finish reason: ${hints.finishReason ?? "not reported"})`,
    };
  }

  // 3. An object with raw line breaks inside its strings, and/or one the model stopped
  //    writing before closing.
  const sanitized = escapeControlCharsInStrings(text);
  for (const { start, end } of candidateBlocks(sanitized)) {
    const candidate = end !== null ? sanitized.slice(start, end) : closeUnfinishedJson(sanitized, start);
    if (!candidate) continue;
    const parsed = tryParseObject(candidate);
    if (parsed.ok && isStageObject(parsed.value)) return { quality: "repaired", value: parsed.value };
  }

  // 4. Narrative only: the prose itself.
  if (hints.stage === "narrative") {
    const narration = salvageNarration(text);
    if (narration) return { quality: "salvaged", value: { narration } };
  }

  return { quality: "failed", error: raw.error };
}

/** Stage-agnostic diagnosis (no narration salvage). Kept for callers without a stage. */
export function diagnoseJson(rawText: string | null | undefined): JsonDiagnosis {
  return recoverStageOutput(rawText);
}

/**
 * Parse a stage's reply for the stage runners. Records how it was read on the stage
 * metadata and throws when the reply cannot be used, which sends the stage to the
 * retry / fallback steps (see ContentGenerationRouter).
 */
export function parseStageJson(
  rawContent: string,
  metadata: { stage?: string; finishReason?: string | null; emptyResponse?: boolean; jsonQuality?: JsonQuality }
): unknown {
  // An empty reply reaches the runners as "{}"; treat it as the failure it is.
  const diagnosis = recoverStageOutput(metadata.emptyResponse ? "" : rawContent, {
    stage: metadata.stage,
    finishReason: metadata.finishReason,
  });
  metadata.jsonQuality = diagnosis.quality;
  if (diagnosis.quality === "failed") {
    throw new Error(diagnosis.error ?? "Response is not valid JSON");
  }
  return diagnosis.value;
}
