import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Trash2 } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { CATALOG_QUERY_KEY } from "./CatalogSection";
import {
  errorMessage,
  formatSeconds,
  formatUsd,
  VERDICT_LABELS,
  verdictBadgeVariant,
  type CatalogResponse,
  type ModelRef,
  type Provider,
  type QualifyResult,
  type QualifyStage,
  type TestTarget,
} from "./shared";

const OTHER = "__other__";
const STAGES: QualifyStage["stage"][] = ["master", "narrative", "actions", "image"];
const STAGE_LABELS: Record<QualifyStage["stage"], string> = {
  master: "Master (scene plan)",
  narrative: "Narrative",
  actions: "Actions",
  image: "Image prompt",
};

interface Scenario {
  id: string;
  name: string;
  description?: string | null;
}

interface Batch {
  id: string;
  model: string;
  scenarioName: string;
  total: number;
  results: QualifyResult[];
  /** Requests that failed outright (server error), as opposed to a run that completed and failed a stage. */
  errors: string[];
  running: boolean;
}

const avg = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

function summarize(batch: Batch) {
  const done = batch.results.length + batch.errors.length;
  const count = (verdict: QualifyResult["verdict"]) => batch.results.filter((r) => r.verdict === verdict).length;
  const costs = batch.results.map((r) => r.costUsd).filter((c): c is number => c !== null);
  return {
    done,
    clean: count("clean"),
    repaired: count("repaired"),
    fallback: count("fallback"),
    // A request that could not even start counts as a failed turn.
    failed: count("failed") + batch.errors.length,
    avgTurnMs: avg(batch.results.filter((r) => r.ok).map((r) => r.turnMs)),
    avgCost: avg(costs),
  };
}

/** Plain-language account of what a stage needed, for the per-run detail. */
function stageNote(s: QualifyStage): string | null {
  const parts: string[] = [];
  if (s.recovery === "retry") parts.push(`needed a second try (${s.firstError ?? "unusable first reply"})`);
  if (s.recovery === "fallback") parts.push(`served by fallback ${s.servedBy ?? "model"} (${s.firstError ?? "the model failed"})`);
  if (s.jsonQuality === "extracted") parts.push("JSON was wrapped in a code fence or extra text");
  if (s.jsonQuality === "repaired") parts.push("JSON was unfinished and had to be closed");
  if (s.jsonQuality === "salvaged") parts.push("JSON was broken; the narration text was recovered from it");
  return parts.length > 0 ? parts.join("; ") : null;
}

interface Props {
  /** A model handed over from Catalog or Discover. The nonce makes repeats re-apply it. */
  target: { nonce: number; target: TestTarget } | null;
}

export function QualifySection({ target }: Props) {
  const qc = useQueryClient();

  const catalog = useQuery<CatalogResponse>({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/llm-models")).json(),
  });
  const scenarios = useQuery<Scenario[]>({
    queryKey: ["/api/admin/pce-inspector/scenarios"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/pce-inspector/scenarios")).json(),
  });
  const models = catalog.data?.models ?? [];

  const [modelChoice, setModelChoice] = useState<string>("");
  const [otherProvider, setOtherProvider] = useState<Provider>("huggingface");
  const [otherModel, setOtherModel] = useState("");
  const [otherJsonMode, setOtherJsonMode] = useState(true);
  const [scenarioId, setScenarioId] = useState("");
  const [runs, setRuns] = useState("3");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!modelChoice && models.length > 0) setModelChoice(models[0].modelKey);
  }, [models, modelChoice]);

  useEffect(() => {
    if (!scenarioId && scenarios.data && scenarios.data.length > 0) setScenarioId(scenarios.data[0].id);
  }, [scenarios.data, scenarioId]);

  useEffect(() => {
    if (!target) return;
    const t = target.target;
    if (t.modelKey) {
      setModelChoice(t.modelKey);
    } else {
      setModelChoice(OTHER);
      setOtherProvider(t.provider);
      setOtherModel(t.model);
      setOtherJsonMode(t.supportsJsonMode ?? true);
    }
  }, [target?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = batches.some((b) => b.running);
  const runCount = Math.min(5, Math.max(1, Number(runs) || 1));
  const canRun =
    !isRunning && scenarioId !== "" && (modelChoice === OTHER ? otherModel.trim() !== "" : modelChoice !== "");

  const start = async () => {
    const catalogRow = models.find((m) => m.modelKey === modelChoice);
    const ref: ModelRef =
      modelChoice === OTHER
        ? { provider: otherProvider, modelName: otherModel.trim(), supportsJsonMode: otherJsonMode }
        : { modelKey: modelChoice };
    const batch: Batch = {
      id: `${Date.now()}`,
      model: modelChoice === OTHER ? otherModel.trim() : catalogRow?.displayName ?? modelChoice,
      scenarioName: scenarios.data?.find((s) => s.id === scenarioId)?.name ?? scenarioId,
      total: runCount,
      results: [],
      errors: [],
      running: true,
    };
    setBatches((prev) => [batch, ...prev]);
    setSelectedId(batch.id);

    const update = (change: (b: Batch) => Batch) =>
      setBatches((prev) => prev.map((b) => (b.id === batch.id ? change(b) : b)));

    for (let i = 0; i < runCount; i++) {
      try {
        const result: QualifyResult = await (
          await apiRequest("POST", "/api/admin/llm-models/qualify", { model: ref, scenarioId })
        ).json();
        update((b) => ({ ...b, results: [...b.results, result] }));
      } catch (error) {
        const message = errorMessage(error);
        update((b) => ({ ...b, errors: [...b.errors, message] }));
      }
    }
    update((b) => ({ ...b, running: false }));
    // The catalog row stores the latest qualification result.
    qc.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
  };

  const selected = batches.find((b) => b.id === selectedId) ?? batches[0] ?? null;

  const stageStats = useMemo(() => {
    if (!selected) return [];
    return STAGES.map((stage) => {
      const reports = selected.results.map((r) => r.stages.find((s) => s.stage === stage)).filter((s): s is QualifyStage => !!s);
      const ran = reports.filter((s) => s.ran);
      const own = ran.filter((s) => s.ok && s.recovery !== "fallback");
      return {
        stage,
        ran: ran.length,
        ok: ran.filter((s) => s.ok).length,
        // First reply was valid JSON as-is.
        raw: own.filter((s) => s.recovery === "none" && s.jsonQuality === "raw").length,
        // The game fixed the JSON wrapping itself, without another model call.
        cleaned: own.filter((s) => s.recovery === "none" && s.jsonQuality !== "raw").length,
        retried: own.filter((s) => s.recovery === "retry").length,
        fallback: ran.filter((s) => s.ok && s.recovery === "fallback").length,
        failed: ran.filter((s) => !s.ok).length,
        avgMs: avg(ran.map((s) => s.durationMs).filter((v): v is number => typeof v === "number")),
        avgOut: avg(ran.map((s) => s.completionTokens).filter((v): v is number => typeof v === "number")),
        truncated: ran.filter((s) => s.finishReason === "length").length,
      };
    });
  }, [selected]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Qualify a model</CardTitle>
          <CardDescription>
            Runs a saved scenario through the game's real four-stage story pipeline with the chosen model, and reports
            whether it would hold up in play. Runs use the same repair, retry and fallback steps as a live turn. Each
            run is also saved in PCE Inspector, tagged <span className="font-mono">qualify</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="q-model">Model</Label>
              <Select value={modelChoice} onValueChange={setModelChoice}>
                <SelectTrigger id="q-model" data-testid="select-qualify-model"><SelectValue placeholder="Choose a model" /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.modelKey} value={m.modelKey}>
                      {m.displayName}{m.active === 1 ? "" : " (draft)"}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Other model (not in the catalog)…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-scenario">Scenario</Label>
              <Select value={scenarioId} onValueChange={setScenarioId}>
                <SelectTrigger id="q-scenario" data-testid="select-qualify-scenario"><SelectValue placeholder="Choose a scenario" /></SelectTrigger>
                <SelectContent>
                  {(scenarios.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-runs">Runs (1–5)</Label>
              <Input id="q-runs" type="number" min={1} max={5} value={runs} onChange={(e) => setRuns(e.target.value)} />
            </div>
          </div>

          {modelChoice === OTHER && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="q-other-provider">Provider</Label>
                <Select value={otherProvider} onValueChange={(v) => setOtherProvider(v as Provider)}>
                  <SelectTrigger id="q-other-provider"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="huggingface">Hugging Face</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="q-other-model">Model id</Label>
                <Input id="q-other-model" className="font-mono text-sm" value={otherModel} onChange={(e) => setOtherModel(e.target.value)} placeholder="e.g. org/model or org/model:provider" />
              </div>
              <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
                <Checkbox checked={otherJsonMode} onCheckedChange={(c) => setOtherJsonMode(!!c)} /> Use JSON mode
              </label>
            </div>
          )}

          {scenarios.data && scenarios.data.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">No scenarios yet. Create one in the PCE Inspector tab first.</p>
          )}

          <Button onClick={start} disabled={!canRun} data-testid="button-qualify-run">
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
            {isRunning ? "Running…" : `Run ${runCount} time${runCount === 1 ? "" : "s"}`}
          </Button>
        </CardContent>
      </Card>

      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Results this session</CardTitle>
                <CardDescription>
                  Clean: valid JSON on the first try. Repaired: the turn completed on the model's own writing, but the
                  game had to fix its JSON or ask twice. Fallback: another model had to step in for a stage. Failed: no
                  turn.
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setBatches([]); setSelectedId(null); }} disabled={isRunning}>
                <Trash2 className="h-4 w-4 mr-1" /> Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Clean</TableHead>
                    <TableHead>Repaired</TableHead>
                    <TableHead>Fallback</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Avg turn time</TableHead>
                    <TableHead>Avg cost / turn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => {
                    const s = summarize(b);
                    return (
                      <TableRow
                        key={b.id}
                        className={`cursor-pointer ${selected?.id === b.id ? "bg-muted" : ""}`}
                        onClick={() => setSelectedId(b.id)}
                      >
                        <TableCell className="font-medium break-all">
                          {b.model}
                          {b.running && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
                        </TableCell>
                        <TableCell>{b.scenarioName}</TableCell>
                        <TableCell>
                          <Badge variant={s.done > 0 && s.clean === s.done ? "secondary" : "outline"}>
                            {s.clean}/{b.running ? `${s.done} of ${b.total}` : s.done}
                          </Badge>
                        </TableCell>
                        <TableCell>{s.repaired}</TableCell>
                        <TableCell>{s.fallback}</TableCell>
                        <TableCell>{s.failed > 0 ? <Badge variant="destructive">{s.failed}</Badge> : 0}</TableCell>
                        <TableCell>{formatSeconds(s.avgTurnMs)}</TableCell>
                        <TableCell>{formatUsd(s.avgCost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {selected && (selected.results.length > 0 || selected.errors.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="break-all">{selected.model}</CardTitle>
            <CardDescription>{selected.scenarioName} · per-stage results</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected.results.length > 0 && (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stage</TableHead>
                      <TableHead>Succeeded</TableHead>
                      <TableHead>Valid first try</TableHead>
                      <TableHead>JSON fixed</TableHead>
                      <TableHead>Needed retry</TableHead>
                      <TableHead>Fallback model</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Avg time</TableHead>
                      <TableHead>Avg output tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stageStats.map((s) => (
                      <TableRow key={s.stage}>
                        <TableCell className="font-medium">{STAGE_LABELS[s.stage]}</TableCell>
                        <TableCell>
                          {s.ran === 0 ? (
                            <span className="text-muted-foreground">Did not run</span>
                          ) : (
                            <Badge variant={s.ok === s.ran ? "secondary" : "destructive"}>{s.ok}/{s.ran}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{s.ran ? s.raw : "—"}</TableCell>
                        <TableCell>{s.ran ? s.cleaned : "—"}</TableCell>
                        <TableCell>{s.ran ? s.retried : "—"}</TableCell>
                        <TableCell>{s.ran ? s.fallback : "—"}</TableCell>
                        <TableCell>{s.ran ? s.failed : "—"}</TableCell>
                        <TableCell>{formatSeconds(s.avgMs)}</TableCell>
                        <TableCell>
                          {s.avgOut === null ? "—" : Math.round(s.avgOut)}
                          {s.truncated > 0 && <Badge variant="destructive" className="ml-2" title="The response hit the token limit">cut off ×{s.truncated}</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {selected.errors.map((e, i) => (
              <div key={`err-${i}`} className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm break-words">
                Run could not start: {e}
              </div>
            ))}

            {selected.results.map((r, i) => {
              const failures = r.stages.filter((s) => s.ran && !s.ok);
              const notes = r.stages
                .filter((s) => s.ran && s.ok)
                .map((s) => ({ stage: s.stage, note: stageNote(s) }))
                .filter((n): n is { stage: QualifyStage["stage"]; note: string } => n.note !== null);
              return (
                <details key={r.runId} className="rounded border p-3" open={i === 0}>
                  <summary className="cursor-pointer text-sm flex flex-wrap items-center gap-2">
                    <span className="font-medium">Run {i + 1}</span>
                    <Badge variant={verdictBadgeVariant(r.verdict)}>{VERDICT_LABELS[r.verdict]}</Badge>
                    <span className="text-muted-foreground">
                      {formatSeconds(r.turnMs)} · {r.promptTokens} in / {r.completionTokens} out · {formatUsd(r.costUsd)}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3 text-sm">
                    {failures.map((s) => (
                      <div key={s.stage} className="rounded border border-destructive/50 bg-destructive/10 p-2 break-words">
                        <span className="font-medium">{STAGE_LABELS[s.stage]}:</span> {s.error ?? "failed"}
                      </div>
                    ))}
                    {notes.length > 0 && (
                      <ul className="rounded border border-amber-500/50 bg-amber-500/10 p-2 space-y-1">
                        {notes.map((n) => (
                          <li key={n.stage} className="break-words">
                            <span className="font-medium">{STAGE_LABELS[n.stage]}:</span> {n.note}
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.narration && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Narration</Label>
                        <p className="whitespace-pre-wrap">{r.narration}</p>
                      </div>
                    )}
                    {r.actions && r.actions.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Actions</Label>
                        <ul className="list-disc pl-5">{r.actions.map((a, j) => <li key={j}>{a}</li>)}</ul>
                      </div>
                    )}
                    {r.imagePrompt && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Image prompt</Label>
                        <p className="whitespace-pre-wrap text-muted-foreground">{r.imagePrompt}</p>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
