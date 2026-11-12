import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Loader2, Play, RefreshCw, Trash2 } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import type { PromptTemplate } from "../types";
import { CATALOG_QUERY_KEY } from "./CatalogSection";
import { PROVIDER_LABELS, errorMessage, targetFromCatalog, type CatalogResponse, type Provider, type TestTarget } from "./shared";

interface RunResult {
  ok: boolean;
  provider: Provider;
  model: string;
  resolvedModel?: string;
  output?: string;
  finishReason?: string | null;
  usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  durationMs: number;
  error?: string;
  upstreamStatus?: number | null;
}

interface HistoryEntry extends RunResult {
  id: string;
  at: string;
  systemPrompt: string;
  userPrompt: string;
}

const MODEL_PLACEHOLDER: Record<Provider, string> = {
  openai: "e.g. gpt-4o-mini",
  huggingface: "e.g. meta-llama/Llama-3.1-8B-Instruct (optionally :provider)",
};

const RECENT_KEY = "uranus-llm-test-recent-models";
const NO_TEMPLATE = "__free_text__";

function readRecent(): Array<{ provider: Provider; model: string }> {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: Array<{ provider: Provider; model: string }>) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    // non-fatal
  }
}

interface Props {
  /** A model handed over from Catalog or Discover. The nonce makes repeats re-apply it. */
  target: { nonce: number; target: TestTarget } | null;
}

export function PlaygroundSection({ target }: Props) {
  const { toast } = useToast();

  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("800");
  const [jsonMode, setJsonMode] = useState(false);
  const [templateName, setTemplateName] = useState(NO_TEMPLATE);
  const [recent, setRecent] = useState(readRecent);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: templates = [] } = useQuery<PromptTemplate[]>({
    queryKey: ["/api/admin/prompt_templates"],
  });

  const catalog = useQuery<CatalogResponse>({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/llm-models")).json(),
  });
  const catalogTargets = useMemo(
    () => (catalog.data?.models ?? []).map((m) => ({ row: m, target: targetFromCatalog(m) })),
    [catalog.data]
  );

  useEffect(() => {
    if (!target) return;
    setProvider(target.target.provider);
    setModel(target.target.model);
  }, [target?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelsQuery = useQuery<{ models: string[] }>({
    queryKey: ["/api/admin/llm-test/models", provider],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/llm-test/models?provider=${provider}`);
      return await res.json();
    },
    enabled: false,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const globalSystem = useMemo(
    () => templates.find((t) => t.name === "global_system_prompt")?.content ?? "",
    [templates]
  );

  const loadTemplate = (name: string) => {
    setTemplateName(name);
    if (name === NO_TEMPLATE) return;
    const t = templates.find((tpl) => tpl.name === name);
    if (!t) return;
    const own = t.systemContent ?? "";
    const system =
      t.name === "global_system_prompt"
        ? t.content
        : t.inheritGlobalPrompt === 1
        ? [globalSystem, own].filter((s) => s.trim()).join("\n\n")
        : own;
    setSystemPrompt(system);
    setUserPrompt(t.name === "global_system_prompt" ? "" : t.content);
    setJsonMode(/\bjson\b/i.test(`${system}\n${t.content}`) && t.name.startsWith("pce_"));
  };

  const placeholders = useMemo(() => {
    const found = new Set<string>();
    for (const m of `${systemPrompt}\n${userPrompt}`.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) {
      found.add(m[1]);
    }
    return Array.from(found);
  }, [systemPrompt, userPrompt]);

  const run = useMutation({
    mutationFn: async (): Promise<RunResult> => {
      const body: Record<string, unknown> = {
        provider,
        model: model.trim(),
        systemPrompt,
        userPrompt,
        jsonMode,
      };
      if (temperature.trim() !== "") body.temperature = Number(temperature);
      if (maxTokens.trim() !== "") body.maxTokens = Number(maxTokens);
      const res = await apiRequest("POST", "/api/admin/llm-test/run", body);
      return await res.json();
    },
    onSuccess: (result) => {
      const entry: HistoryEntry = {
        ...result,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toLocaleTimeString(),
        systemPrompt,
        userPrompt,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 50));
      setSelectedId(entry.id);
      if (result.ok) {
        const next = [{ provider, model: model.trim() }, ...recent.filter((r) => !(r.provider === provider && r.model === model.trim()))];
        setRecent(next);
        writeRecent(next);
      }
    },
    onError: (error: any) => {
      toast({ title: "Request failed", description: errorMessage(error), variant: "destructive" });
    },
  });

  const canRun = model.trim() !== "" && (systemPrompt.trim() !== "" || userPrompt.trim() !== "") && !run.isPending;
  const selected = history.find((h) => h.id === selectedId) ?? history[0] ?? null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const prettyOutput = (text: string | undefined) => {
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Send one prompt to one model. Nothing here changes the game. Runs also appear in LLM Logs as{" "}
        <span className="font-mono">devtools.llm_test</span>.
      </p>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Request */}
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>Pick a model, write or load a prompt, and run it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="llm-provider">Provider</Label>
                <Select value={provider} onValueChange={(v) => { setProvider(v as Provider); setModel(""); }}>
                  <SelectTrigger id="llm-provider" data-testid="select-llm-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="huggingface">Hugging Face</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="llm-model">Model</Label>
                <div className="flex gap-2">
                  <Input
                    id="llm-model"
                    list="llm-model-suggestions"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={MODEL_PLACEHOLDER[provider]}
                    className="font-mono text-sm"
                    data-testid="input-llm-model"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Fetch available models from the provider"
                    onClick={() => modelsQuery.refetch()}
                    disabled={modelsQuery.isFetching}
                  >
                    {modelsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </div>
                <datalist id="llm-model-suggestions">
                  {(modelsQuery.data?.models ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  {modelsQuery.isError
                    ? `Couldn't list models: ${String((modelsQuery.error as any)?.message ?? modelsQuery.error)}`
                    : modelsQuery.data
                    ? `${modelsQuery.data.models.length} models available — start typing to filter.`
                    : provider === "huggingface"
                    ? "Any chat model served by an HF Inference Provider. Refresh to list them."
                    : "Any OpenAI chat model id. Refresh to list them."}
                </p>
              </div>
            </div>

            {catalogTargets.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From the catalog</Label>
                <div className="flex flex-wrap gap-2">
                  {catalogTargets.map(({ row, target: t }) => (
                    <Badge
                      key={`catalog:${row.modelKey}`}
                      variant={t.provider === provider && t.model === model ? "default" : "secondary"}
                      className="cursor-pointer"
                      title={`${t.model}${row.notes ? `\n${row.notes}` : ""}`}
                      onClick={() => { setProvider(t.provider); setModel(t.model); }}
                      data-testid={`chip-catalog-${row.modelKey}`}
                    >
                      {row.displayName}{row.adult ? " · 18+" : ""}{row.active === 1 ? "" : " · draft"}
                    </Badge>
                  ))}
                </div>
                {(() => {
                  const active = catalogTargets.find(({ target: t }) => t.provider === provider && t.model === model);
                  return active?.row.notes ? <p className="text-xs text-muted-foreground">{active.row.notes}</p> : null;
                })()}
              </div>
            )}

            {recent.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <Badge
                    key={`${r.provider}:${r.model}`}
                    variant={r.provider === provider && r.model === model ? "default" : "outline"}
                    className="cursor-pointer font-mono"
                    onClick={() => { setProvider(r.provider); setModel(r.model); }}
                  >
                    {r.provider === "huggingface" ? "HF · " : ""}{r.model}
                  </Badge>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="llm-template">Start from</Label>
              <Select value={templateName} onValueChange={loadTemplate}>
                <SelectTrigger id="llm-template" data-testid="select-llm-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>Free text</SelectItem>
                  {templates
                    .filter((t) => t.name !== "visual_style_prompt")
                    .map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        Template: {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {placeholders.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Unfilled placeholders will be sent as-is: {placeholders.map((p) => `{{${p}}}`).join(", ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-system">System prompt</Label>
              <Textarea
                id="llm-system"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Optional instructions for the model"
                className="h-[140px] font-mono text-sm"
                data-testid="textarea-llm-system"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-user">User prompt</Label>
              <Textarea
                id="llm-user"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) run.mutate();
                }}
                placeholder="What do you want to ask? (Ctrl/⌘+Enter to run)"
                className="h-[180px] font-mono text-sm"
                data-testid="textarea-llm-user"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="llm-temp">Temperature</Label>
                <Input
                  id="llm-temp"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="model default"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="llm-max">Max tokens</Label>
                <Input
                  id="llm-max"
                  type="number"
                  min="1"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id="llm-json" checked={jsonMode} onCheckedChange={(c) => setJsonMode(!!c)} />
                <Label htmlFor="llm-json" className="font-normal cursor-pointer">JSON mode</Label>
              </div>
            </div>

            <Button className="w-full" onClick={() => run.mutate()} disabled={!canRun} data-testid="button-llm-run">
              {run.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              {run.isPending ? `Running ${model}…` : "Run"}
            </Button>
          </CardContent>
        </Card>

        {/* Response */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Response</CardTitle>
                <CardDescription>
                  {selected ? `${PROVIDER_LABELS[selected.provider]} · ${selected.resolvedModel ?? selected.model}` : "Run a prompt to see the output here."}
                </CardDescription>
              </div>
              {selected?.ok && selected.output && (
                <Button variant="outline" size="sm" onClick={() => copy(selected.output!)}>
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant={selected.ok ? "secondary" : "destructive"}>{selected.ok ? "OK" : "Error"}</Badge>
                  <Badge variant="outline">{(selected.durationMs / 1000).toFixed(2)}s</Badge>
                  {selected.usage?.promptTokens != null && <Badge variant="outline">in {selected.usage.promptTokens} tok</Badge>}
                  {selected.usage?.completionTokens != null && <Badge variant="outline">out {selected.usage.completionTokens} tok</Badge>}
                  {selected.finishReason && <Badge variant="outline">finish: {selected.finishReason}</Badge>}
                  {selected.upstreamStatus != null && <Badge variant="outline">HTTP {selected.upstreamStatus}</Badge>}
                </div>
                {selected.ok ? (
                  <ScrollArea className="h-[420px] rounded border bg-muted/30">
                    <pre className="p-3 text-sm whitespace-pre-wrap break-words font-mono">
                      {prettyOutput(selected.output) || <span className="text-muted-foreground">(empty response)</span>}
                    </pre>
                  </ScrollArea>
                ) : (
                  <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm break-words">
                    {selected.error}
                  </div>
                )}
              </>
            ) : (
              <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">
                No runs yet
              </div>
            )}

            {history.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>This session ({history.length})</Label>
                  <Button variant="ghost" size="sm" onClick={() => { setHistory([]); setSelectedId(null); }}>
                    <Trash2 className="h-4 w-4 mr-1" /> Clear
                  </Button>
                </div>
                <ScrollArea className="h-[180px] rounded border">
                  <div className="divide-y">
                    {history.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setSelectedId(h.id)}
                        className={`w-full text-left p-2 text-xs hover:bg-muted/50 ${selected?.id === h.id ? "bg-muted" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono truncate">
                            {h.provider === "huggingface" ? "HF · " : ""}{h.model}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {h.ok ? `${(h.durationMs / 1000).toFixed(1)}s` : "error"} · {h.at}
                          </span>
                        </div>
                        <div className="text-muted-foreground truncate">{h.userPrompt || h.systemPrompt}</div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

