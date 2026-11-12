import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FlaskConical, Loader2, RefreshCw } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { CATALOG_QUERY_KEY } from "./llm/CatalogSection";
import {
  errorMessage,
  formatSeconds,
  formatUsd,
  VERDICT_LABELS,
  verdictBadgeVariant,
  type CatalogResponse,
  type QualifyVerdict,
} from "./llm/shared";

const DEFAULT_MODEL = "__default__";
const ALL_SCENARIOS = "__all__";
const UTILITY_JUDGE = "__utility__";

interface EvaluatorInfo {
  key: string;
  title: string;
  kind: "code" | "judge";
  description: string;
}

interface EvalStatus {
  tracing: { enabled: boolean; reason?: string; project: string; hideInputs: boolean; hideOutputs: boolean };
  dataset: { name: string; scenarioCount: number; exampleCount: number | null; tags: string[] };
  evaluators: EvaluatorInfo[];
  settings: { liveSampleRate: number; judgeModelKey: string | null; judgeModel: string };
  runningExperimentId: string | null;
}

interface EvalScore {
  key: string;
  score: number | null;
  comment?: string;
}

interface ExperimentRow {
  scenarioId: string;
  scenario: string;
  verdict: QualifyVerdict;
  turnMs: number;
  costUsd: number | null;
  scores: EvalScore[];
  error?: string;
}

interface Experiment {
  id: string;
  name: string | null;
  status: "running" | "completed" | "failed";
  model: string;
  modelKey: string | null;
  promptSource: "reference" | "database";
  releaseVersion: string | null;
  scenarioTag: string | null;
  judges: string[];
  judgeModel: string | null;
  exampleCount: number | null;
  summary: {
    scores: Record<string, { mean: number | null; n: number }>;
    verdicts: Record<QualifyVerdict, number>;
    turnMsMean: number | null;
    costUsd: number | null;
    rows: ExperimentRow[];
  } | null;
  langsmithUrl: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const STATUS_KEY = ["/api/admin/evals/status"];
const EXPERIMENTS_KEY = ["/api/admin/evals/experiments"];

const PROMPT_LABELS: Record<Experiment["promptSource"], string> = {
  reference: "Published",
  database: "Draft",
};

const formatScore = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toFixed(2));

/** Difference from the baseline, with enough of a dead zone that noise does not read as change. */
function Delta({ value, baseline }: { value: number | null | undefined; baseline: number | null | undefined }) {
  if (value === null || value === undefined || baseline === null || baseline === undefined) return null;
  const diff = value - baseline;
  if (Math.abs(diff) < 0.005) return <span className="ml-1 text-xs text-muted-foreground">=</span>;
  return (
    <span className={`ml-1 text-xs ${diff > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
      {diff > 0 ? "+" : "−"}
      {Math.abs(diff).toFixed(2)}
    </span>
  );
}

/**
 * Dev Tools → Evals. Score the story pipeline on the saved PCE scenarios (offline
 * experiments), compare a model or a prompt draft against a baseline, and choose how many
 * live turns are scored.
 */
export function EvalsTab() {
  const qc = useQueryClient();

  const status = useQuery<EvalStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/evals/status")).json(),
  });
  const experiments = useQuery<{ experiments: Experiment[]; runningExperimentId: string | null }>({
    queryKey: EXPERIMENTS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/evals/experiments")).json(),
    // While one is running, keep the list fresh so its result appears without a reload.
    refetchInterval: (query) => (query.state.data?.runningExperimentId ? 4000 : false),
  });
  const catalog = useQuery<CatalogResponse>({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/llm-models")).json(),
  });

  const evaluators = status.data?.evaluators ?? [];
  const judges = evaluators.filter((e) => e.kind === "judge");
  const list = experiments.data?.experiments ?? [];
  const running = !!experiments.data?.runningExperimentId;
  const tracingOn = status.data?.tracing.enabled ?? false;

  // Run form
  const [modelKey, setModelKey] = useState(DEFAULT_MODEL);
  const [promptSource, setPromptSource] = useState<Experiment["promptSource"]>("reference");
  const [scenarioTag, setScenarioTag] = useState(ALL_SCENARIOS);
  const [selectedJudges, setSelectedJudges] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Judges are all on until the user changes them.
  const activeJudges = selectedJudges ?? judges.map((j) => j.key);

  // Results
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const selected = list.find((e) => e.id === selectedId) ?? list.find((e) => e.status !== "running") ?? null;
  const baseline = list.find((e) => e.id === baselineId) ?? null;

  // Dataset and settings
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [judgeModelKey, setJudgeModelKey] = useState(UTILITY_JUDGE);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);

  useEffect(() => {
    if (!status.data) return;
    setRateInput(String(Math.round(status.data.settings.liveSampleRate * 100)));
    setJudgeModelKey(status.data.settings.judgeModelKey ?? UTILITY_JUDGE);
  }, [status.data?.settings.liveSampleRate, status.data?.settings.judgeModelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a run finishes, the dataset count and status may have changed too.
  useEffect(() => {
    if (!running) qc.invalidateQueries({ queryKey: STATUS_KEY });
  }, [running, qc]);

  const scoreKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const e of list) for (const key of Object.keys(e.summary?.scores ?? {})) keys.add(key);
    // Evaluator order first, then anything left over from older experiments.
    const ordered = evaluators.map((e) => e.key).filter((key) => keys.has(key));
    return [...ordered, ...[...keys].filter((key) => !ordered.includes(key))];
  }, [list, evaluators]);
  const titleOf = (key: string) => evaluators.find((e) => e.key === key)?.title ?? key;

  const start = async () => {
    setStarting(true);
    setRunError(null);
    try {
      const res = await apiRequest("POST", "/api/admin/evals/experiments", {
        modelKey: modelKey === DEFAULT_MODEL ? null : modelKey,
        promptSource,
        judges: activeJudges,
        scenarioTag: scenarioTag === ALL_SCENARIOS ? null : scenarioTag,
      });
      const created = (await res.json()) as Experiment;
      setSelectedId(created.id);
      await qc.invalidateQueries({ queryKey: EXPERIMENTS_KEY });
    } catch (error) {
      setRunError(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await apiRequest("POST", "/api/admin/evals/dataset/sync");
      const r = (await res.json()) as { total: number; created: number; updated: number; deleted: number };
      setSyncNote(`${r.total} scenarios in the dataset (${r.created} added, ${r.updated} updated, ${r.deleted} removed).`);
      await qc.invalidateQueries({ queryKey: STATUS_KEY });
    } catch (error) {
      setSyncNote(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  const ratePercent = Number(rateInput);
  const rateValid = rateInput.trim() !== "" && Number.isFinite(ratePercent) && ratePercent >= 0 && ratePercent <= 100;

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsNote(null);
    try {
      await apiRequest("PUT", "/api/admin/evals/settings", {
        liveSampleRate: ratePercent / 100,
        judgeModelKey: judgeModelKey === UTILITY_JUDGE ? null : judgeModelKey,
      });
      setSettingsNote("Saved. Takes effect within 30 seconds.");
      await qc.invalidateQueries({ queryKey: STATUS_KEY });
    } catch (error) {
      setSettingsNote(errorMessage(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const models = catalog.data?.models ?? [];
  const dataset = status.data?.dataset;
  const canRun = tracingOn && !running && !starting && (dataset?.scenarioCount ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Evals</h2>
        <p className="text-sm text-muted-foreground">
          Score the story pipeline on your saved scenarios. Run an experiment for a model or for your prompt drafts,
          then compare it with a baseline before you publish. Scenarios are created in the PCE Inspector tab.
        </p>
      </div>

      {status.isError && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm">
          Could not load eval status: {errorMessage(status.error)}
        </div>
      )}

      {status.data && !tracingOn && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="evals-tracing-off">
          <p className="font-medium">LangSmith is not connected, so experiments cannot run.</p>
          <p className="text-muted-foreground">
            {status.data.tracing.reason}. Set <code>LANGSMITH_TRACING=true</code> and <code>LANGSMITH_API_KEY</code> in{" "}
            <code>.env</code>, then restart the app. Live-turn sampling still works without it; scores are kept on the
            turn and shown in Game Telemetry.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run an experiment</CardTitle>
          <CardDescription>
            Every scenario is run once through all four stages and scored. An experiment on {dataset?.scenarioCount ?? "…"}{" "}
            scenarios makes about {(dataset?.scenarioCount ?? 0) * (4 + activeJudges.length)} model calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Story model</Label>
              <Select value={modelKey} onValueChange={setModelKey}>
                <SelectTrigger data-testid="select-eval-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL}>Catalog default</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.modelKey} value={m.modelKey}>
                      {m.displayName}
                      {m.active !== 1 ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prompts</Label>
              <Select value={promptSource} onValueChange={(v) => setPromptSource(v as Experiment["promptSource"])}>
                <SelectTrigger data-testid="select-eval-prompts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">Published (what players get)</SelectItem>
                  <SelectItem value="database">Draft (current edits in Prompts)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Scenarios</Label>
              <Select value={scenarioTag} onValueChange={setScenarioTag}>
                <SelectTrigger data-testid="select-eval-tag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SCENARIOS}>All {dataset?.scenarioCount ?? ""} scenarios</SelectItem>
                  {(dataset?.tags ?? []).map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      Tagged “{tag}”
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Scored on</Label>
            <ul className="grid gap-2 md:grid-cols-2">
              {evaluators.map((e) => (
                <li key={e.key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    id={`eval-${e.key}`}
                    className="mt-0.5"
                    checked={e.kind === "code" || activeJudges.includes(e.key)}
                    disabled={e.kind === "code"}
                    onCheckedChange={(checked) =>
                      setSelectedJudges(
                        checked ? [...activeJudges.filter((k) => k !== e.key), e.key] : activeJudges.filter((k) => k !== e.key),
                      )
                    }
                  />
                  <label htmlFor={`eval-${e.key}`}>
                    <span className="font-medium">{e.title}</span>{" "}
                    <Badge variant="outline" className="ml-1">
                      {e.kind === "code" ? "rule" : "judge"}
                    </Badge>
                    <span className="block text-muted-foreground">{e.description}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Rules are free and always run. Judges are model calls, graded by {status.data?.settings.judgeModel ?? "…"}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={start} disabled={!canRun} data-testid="button-run-experiment">
              {starting || running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
              {running ? "Experiment running…" : "Run experiment"}
            </Button>
            {dataset && dataset.scenarioCount === 0 && (
              <span className="text-sm text-muted-foreground">Save a scenario in the PCE Inspector tab first.</span>
            )}
            {runError && <span className="text-sm text-destructive break-words">{runError}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Experiments</CardTitle>
          <CardDescription>
            Scores are means from 0 to 1. Pick a baseline to see what changed; select a row for per-scenario results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No experiments yet.</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Baseline</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Prompts</TableHead>
                    <TableHead>Verdicts</TableHead>
                    {scoreKeys.map((key) => (
                      <TableHead key={key}>{titleOf(key)}</TableHead>
                    ))}
                    <TableHead>Avg turn</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((e) => {
                    const s = e.summary;
                    const isBaseline = baseline?.id === e.id;
                    return (
                      <TableRow
                        key={e.id}
                        className={`cursor-pointer ${selected?.id === e.id ? "bg-muted" : ""}`}
                        onClick={() => setSelectedId(e.id)}
                        data-testid={`row-experiment-${e.id}`}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            aria-label="Use as baseline"
                            checked={isBaseline}
                            disabled={e.status !== "completed"}
                            onCheckedChange={(checked) => setBaselineId(checked ? e.id : null)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleString()}
                          {e.status === "running" && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
                          {e.status === "failed" && (
                            <Badge variant="destructive" className="ml-2">
                              failed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="break-all">{e.model}</TableCell>
                        <TableCell>
                          <Badge variant={e.promptSource === "database" ? "outline" : "secondary"}>
                            {PROMPT_LABELS[e.promptSource]}
                          </Badge>
                          {e.scenarioTag && <span className="ml-2 text-xs text-muted-foreground">“{e.scenarioTag}”</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {s ? (
                            <>
                              <Badge variant={s.verdicts.failed > 0 ? "destructive" : "secondary"}>
                                {s.verdicts.clean}/{s.rows.length} clean
                              </Badge>
                              {s.verdicts.failed > 0 && <span className="ml-2 text-xs">{s.verdicts.failed} failed</span>}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        {scoreKeys.map((key) => (
                          <TableCell key={key} className="whitespace-nowrap">
                            {formatScore(s?.scores[key]?.mean)}
                            {baseline && !isBaseline && (
                              <Delta value={s?.scores[key]?.mean} baseline={baseline.summary?.scores[key]?.mean} />
                            )}
                          </TableCell>
                        ))}
                        <TableCell>{formatSeconds(s?.turnMsMean)}</TableCell>
                        <TableCell>{formatUsd(s?.costUsd)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="break-all">{selected.name ?? selected.model}</CardTitle>
            <CardDescription>
              {selected.model} · {PROMPT_LABELS[selected.promptSource].toLowerCase()} prompts
              {selected.releaseVersion ? ` · release ${selected.releaseVersion}` : ""}
              {selected.judgeModel ? ` · judged by ${selected.judgeModel}` : " · rules only"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected.langsmithUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={selected.langsmithUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open in LangSmith
                </a>
              </Button>
            )}
            {selected.status === "running" && (
              <p className="text-sm text-muted-foreground">
                <Loader2 className="inline h-3 w-3 mr-2 animate-spin" />
                Running {selected.exampleCount ?? ""} scenarios. Results appear here when it finishes.
              </p>
            )}
            {selected.error && (
              <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm break-words">
                {selected.error}
              </div>
            )}
            {(selected.summary?.rows ?? []).map((row) => (
              <details key={row.scenarioId} className="rounded border p-3">
                <summary className="cursor-pointer text-sm flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.scenario}</span>
                  <Badge variant={verdictBadgeVariant(row.verdict)}>{VERDICT_LABELS[row.verdict]}</Badge>
                  <span className="text-muted-foreground">
                    {formatSeconds(row.turnMs)} · {formatUsd(row.costUsd)}
                  </span>
                  {row.scores
                    .filter((s) => s.key !== "structural_verdict")
                    .map((s) => (
                      <span key={s.key} className="text-xs text-muted-foreground">
                        {titleOf(s.key)} {formatScore(s.score)}
                      </span>
                    ))}
                </summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {row.error && <li className="text-destructive break-words">{row.error}</li>}
                  {row.scores.map((s) => (
                    <li key={s.key} className="break-words">
                      <span className="font-medium">
                        {titleOf(s.key)}: {formatScore(s.score)}
                      </span>
                      {s.comment && <span className="text-muted-foreground"> — {s.comment}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dataset</CardTitle>
            <CardDescription>
              The saved scenarios, mirrored to LangSmith as “{dataset?.name ?? "…"}”. It is synced automatically before
              every experiment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {dataset?.scenarioCount ?? "…"} saved scenarios ·{" "}
              {dataset?.exampleCount === null || dataset?.exampleCount === undefined
                ? "not in LangSmith yet"
                : `${dataset.exampleCount} in LangSmith`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={sync} disabled={!tracingOn || syncing} data-testid="button-sync-dataset">
                {syncing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Sync now
              </Button>
              {syncNote && <span className="text-muted-foreground break-words">{syncNote}</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live turns</CardTitle>
            <CardDescription>
              Score a share of real player turns in the background with the same rules and judges. Each sampled turn
              costs {judges.length} judge calls and never delays the player.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="eval-sample-rate">Turns to score (%)</Label>
                <Input
                  id="eval-sample-rate"
                  type="number"
                  min={0}
                  max={100}
                  value={rateInput}
                  onChange={(event) => setRateInput(event.target.value)}
                  data-testid="input-sample-rate"
                />
                <p className="text-xs text-muted-foreground">Set to 0 to turn sampling off.</p>
              </div>
              <div className="space-y-1">
                <Label>Judge model</Label>
                <Select value={judgeModelKey} onValueChange={setJudgeModelKey}>
                  <SelectTrigger data-testid="select-judge-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UTILITY_JUDGE}>Built-in (gpt-4o-mini)</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m.modelKey} value={m.modelKey}>
                        {m.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Also grades offline experiments.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={saveSettings} disabled={!rateValid || savingSettings} data-testid="button-save-eval-settings">
                {savingSettings && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Save
              </Button>
              {!rateValid && <span className="text-sm text-destructive">Enter a number from 0 to 100.</span>}
              {settingsNote && <span className="text-sm text-muted-foreground break-words">{settingsNote}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              Scores for sampled turns appear in Game Telemetry{tracingOn ? " and on the turn’s trace in LangSmith" : ""}.
              To change what a judge looks for, add a prompt in the Prompts tab named after it, for example{" "}
              <code>eval_judge_narration_quality</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default EvalsTab;
