import { createHash } from "crypto";
import type { Event, GameStats, TriggerCondition } from "@shared/schema";
import { storage } from "../server/storage";
import { pool } from "../server/db";

type Direction = "low" | "high";

interface BackfillPlan {
  condition: TriggerCondition;
  reason: string;
}

interface ParsedDelta {
  stat: keyof GameStats;
  delta: number;
  source: "pass" | "fail";
}

const GAME_STATS: readonly (keyof GameStats)[] = ["hull", "oxygen", "fuel", "food", "morale", "weirdness"] as const;
const STAT_SET = new Set<string>(GAME_STATS);

const CYCLICAL_KEYWORDS = ["cycle", "rotation", "ritual", "orbit", "shift", "festival", "checkup", "inspection"];
const RANDOM_KEYWORDS = ["anomaly", "chaos", "mystery", "glitch", "cosmic", "oddity", "strange"];

const args = new Set(process.argv.slice(2));
const applyChanges = args.has("--apply");
const deactivateMissing = args.has("--deactivate-missing");
const onlyArg = Array.from(args).find(arg => arg.startsWith("--only="));
const onlyIds = onlyArg ? new Set(onlyArg.replace("--only=", "").split(",").map(id => id.trim()).filter(Boolean)) : null;

function isValidTriggerCondition(condition: unknown): condition is TriggerCondition {
  if (typeof condition !== "object" || condition === null) return false;
  const type = (condition as { type?: unknown }).type;
  return typeof type === "string";
}

function hashFraction(id: string, salt: string): number {
  const hex = createHash("sha256").update(`${id}:${salt}`).digest("hex").slice(0, 8);
  const int = parseInt(hex, 16);
  return int / 0xffffffff;
}

function parseDelta(effect: string | null | undefined, source: "pass" | "fail"): ParsedDelta[] {
  if (!effect) return [];
  const deltas: ParsedDelta[] = [];
  const regex = /([a-z_]+)([+-]\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(effect)) !== null) {
    const statKey = match[1].toLowerCase();
    if (!STAT_SET.has(statKey)) continue;
    const stat = statKey as keyof GameStats;
    const delta = Number(match[2]);
    if (Number.isNaN(delta)) continue;
    deltas.push({ stat, delta, source });
  }
  return deltas;
}

function deriveStatFromEffects(event: Event): { stat: keyof GameStats; direction: Direction; magnitude: number; reason: string } | null {
  const passEffects = parseDelta(event.passEffect, "pass");
  const failEffects = parseDelta(event.failEffect, "fail");
  const all = [...passEffects, ...failEffects];
  if (all.length === 0) return null;

  const weighted = new Map<
    keyof GameStats,
    { score: number; direction: Direction; magnitude: number; source: "pass" | "fail"; delta: number }
  >();

  for (const detail of all) {
    const direction: Direction = detail.delta >= 0 ? "low" : "high";
    const magnitude = Math.abs(detail.delta);
    const weight = magnitude + (detail.source === "pass" ? 1 : 0.5);
    const current = weighted.get(detail.stat);
    if (!current || weight > current.score) {
      weighted.set(detail.stat, { score: weight, direction, magnitude, source: detail.source, delta: detail.delta });
    }
  }

  let best: { stat: keyof GameStats; direction: Direction; magnitude: number; reason: string; score: number } | null = null;
  for (const [stat, info] of Array.from(weighted.entries())) {
    const reason = info.source === "pass"
      ? `pass effect ${info.delta > 0 ? "boosts" : "reduces"} ${stat}`
      : `fail effect ${info.delta > 0 ? "boosts" : "reduces"} ${stat}`;
    if (!best || info.score > best.score) {
      best = { stat, direction: info.direction, magnitude: info.magnitude, reason, score: info.score };
    }
  }

  return best ? { stat: best.stat, direction: best.direction, magnitude: best.magnitude, reason: best.reason } : null;
}

function tagsToStat(event: Event): { stat: keyof GameStats; direction: Direction; reason: string } | null {
  const tags = Array.isArray(event.tags) ? event.tags.map(tag => String(tag).toLowerCase()) : [];
  if (tags.length === 0) return null;

  const hasAny = (keywords: string[]) => keywords.some(keyword => tags.includes(keyword));

  if (hasAny(["crew", "social", "relationship", "party"])) {
    return { stat: "morale", direction: "low", reason: "crew/social tag suggests morale recovery" };
  }
  if (hasAny(["ship", "hull", "damage", "repair"])) {
    return { stat: "hull", direction: "low", reason: "ship-related tag implies hull upkeep" };
  }
  if (hasAny(["oxygen", "life_support"])) {
    return { stat: "oxygen", direction: "low", reason: "life support tag implies oxygen safety check" };
  }
  if (hasAny(["fuel", "engine", "burn"])) {
    return { stat: "fuel", direction: "low", reason: "engine tag implies fuel management" };
  }
  if (hasAny(["food", "galley", "kitchen", "supply"])) {
    return { stat: "food", direction: "low", reason: "provisions tag implies food replenishment" };
  }
  if (hasAny(["weird", "anomaly", "eldritch", "cosmic"])) {
    return { stat: "weirdness", direction: "high", reason: "anomaly tag manages rising weirdness" };
  }

  return null;
}

function nameHint(event: Event): { stat: keyof GameStats; direction: Direction; reason: string } | null {
  const lower = event.name.toLowerCase();
  if (lower.includes("team") || lower.includes("pep")) {
    return { stat: "morale", direction: "low", reason: "name implies morale rally" };
  }
  if (lower.includes("patch") || lower.includes("repair")) {
    return { stat: "hull", direction: "low", reason: "name references repairs" };
  }
  if (lower.includes("oxygen") || lower.includes("airlock")) {
    return { stat: "oxygen", direction: "low", reason: "name references oxygen systems" };
  }
  if (lower.includes("fuel") || lower.includes("refuel") || lower.includes("burn")) {
    return { stat: "fuel", direction: "low", reason: "name references fuel burn" };
  }
  if (lower.includes("banquet") || lower.includes("cook") || lower.includes("ration")) {
    return { stat: "food", direction: "low", reason: "name references food supplies" };
  }
  if (lower.includes("anomaly") || lower.includes("ritual") || lower.includes("void")) {
    return { stat: "weirdness", direction: "high", reason: "name references anomalous behaviour" };
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function thresholdFor(stat: keyof GameStats, direction: Direction, magnitude: number): number {
  if (stat === "weirdness") {
    return direction === "low"
      ? clamp(1 + Math.round(magnitude / 2), 0, 3)
      : clamp(3 + Math.round(magnitude / 2), 3, 5);
  }

  const base = direction === "low" ? 50 : 65;
  const adjustment = magnitude >= 5 ? magnitude * 2 : magnitude;
  const raw = direction === "low" ? base - adjustment : base + adjustment;
  return clamp(Math.round(raw / 5) * 5, 10, 95);
}

function maybeDayModuloCondition(event: Event): TriggerCondition | null {
  const tags = Array.isArray(event.tags) ? event.tags.map(tag => String(tag).toLowerCase()) : [];
  const hasCycleTag = tags.some(tag => CYCLICAL_KEYWORDS.includes(tag));
  if (!hasCycleTag && event.segment === "Any") {
    return null;
  }

  const divisor = 2 + Math.floor(hashFraction(event.id, "divisor") * 3); // 2-4
  const remainder = Math.floor(hashFraction(event.id, "remainder") * divisor);
  return { type: "day_modulo", divisor, remainder };
}

function maybeRandomCondition(event: Event): TriggerCondition | null {
  const tags = Array.isArray(event.tags) ? event.tags.map(tag => String(tag).toLowerCase()) : [];
  const needsRandom = tags.some(tag => RANDOM_KEYWORDS.includes(tag));
  if (!needsRandom) {
    return null;
  }

  const chance = clamp(Number((0.25 + hashFraction(event.id, "chance") * 0.35).toFixed(2)), 0.1, 0.6);
  return { type: "random", chance };
}

function buildBackfill(event: Event): BackfillPlan | null {
  const parts: TriggerCondition[] = [];
  const reasons: string[] = [];

  const effectHint = deriveStatFromEffects(event);
  const altHint = effectHint ?? tagsToStat(event) ?? nameHint(event);

  if (altHint) {
    const threshold = thresholdFor(altHint.stat, altHint.direction, effectHint ? effectHint.magnitude : 3);
    const operator = altHint.direction === "low" ? "<=" : ">=";
    parts.push({
      type: "stat",
      stat: altHint.stat,
      operator,
      value: threshold,
    });
    reasons.push(altHint.reason);
  }

  const dayCondition = maybeDayModuloCondition(event);
  if (dayCondition) {
    parts.push(dayCondition);
    reasons.push("adds cadence guard (day modulo)");
  }

  const randomCondition = maybeRandomCondition(event);
  if (randomCondition) {
    parts.push(randomCondition);
    reasons.push("injects thematic randomness");
  }

  if (parts.length === 0) {
    const fallbackChance = clamp(Number((0.3 + hashFraction(event.id, "fallback") * 0.4).toFixed(2)), 0.2, 0.7);
    return {
      condition: { type: "random", chance: fallbackChance },
      reason: "fallback random trigger (no stat or thematic hints)",
    };
  }

  const condition: TriggerCondition = parts.length === 1
    ? parts[0]
    : { type: "and", conditions: parts };

  return {
    condition,
    reason: reasons.join("; "),
  };
}

async function main(): Promise<void> {
  console.log("🔍 Scanning events for missing or invalid trigger conditions...");
  const events = await storage.getAllEvents();
  const invalidEvents = events.filter(event => !isValidTriggerCondition(event.triggerCondition));
  const filtered = onlyIds
    ? invalidEvents.filter(event => onlyIds.has(event.id))
    : invalidEvents;

  if (filtered.length === 0) {
    console.log("✅ No events require backfill.");
    return;
  }

  console.log(`Found ${filtered.length} event(s) needing backfill${applyChanges ? "" : " (dry run)"}.`);

  const updated: string[] = [];
  const skipped: string[] = [];
  const deactivated: string[] = [];

  for (const event of filtered) {
    const plan = buildBackfill(event);
    if (!plan) {
      console.warn(`⚠️ Unable to derive trigger for ${event.id} (${event.name}).`);
      skipped.push(event.id);
      if (applyChanges && deactivateMissing) {
        await storage.updateEvent(event.id, { active: 0 });
        console.log(`   → Deactivated ${event.id}`);
        deactivated.push(event.id);
      }
      continue;
    }

    console.log(`🎯 ${event.id} (${event.name})`);
    console.log(`   Reason: ${plan.reason}`);
    console.log(`   Condition: ${JSON.stringify(plan.condition)}`);

    if (applyChanges) {
      await storage.updateEvent(event.id, { triggerCondition: plan.condition });
    }
    updated.push(event.id);
  }

  console.log("");
  console.log(`Summary: ${updated.length} updated, ${skipped.length} skipped${deactivated.length ? `, ${deactivated.length} deactivated` : ""}.`);
  if (!applyChanges) {
    console.log("Run again with --apply to persist these changes.");
  }
  if (skipped.length > 0 && !deactivateMissing) {
    console.log("Consider rerunning with --deactivate-missing to disable events without a viable backfill.");
  }
}

main()
  .catch(error => {
    console.error("Backfill script failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
