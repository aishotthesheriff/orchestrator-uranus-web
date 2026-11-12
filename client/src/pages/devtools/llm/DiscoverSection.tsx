import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FlaskConical, Loader2, Play, Plus, RefreshCw, Search } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  EMPTY_DRAFT,
  errorMessage,
  formatContext,
  formatPrice,
  suggestModelKey,
  type CatalogDraft,
  type DiscoveredModel,
  type DiscoveredProvider,
  type Provider,
  type TestTarget,
} from "./shared";

type Source = "hf-router" | "hf-hub" | "openai";

const SOURCES: Record<Source, { label: string; hint: string }> = {
  "hf-router": {
    label: "Hugging Face: served models",
    hint: "Chat models Hugging Face Inference Providers serve right now, with live price and speed per provider.",
  },
  "hf-hub": {
    label: "Hugging Face: search the Hub",
    hint: "Find community models (roleplay and abliterated fine-tunes) that the served list leaves out. A model only works if a provider enabled on your Hugging Face account serves it.",
  },
  openai: { label: "OpenAI", hint: "Chat models available to your OpenAI key." },
};

const MAX_ROWS = 150;

interface DiscoverResponse {
  source: Source;
  provider: Provider;
  fetchedAt: string;
  models: DiscoveredModel[];
}

interface Props {
  onTest: (target: TestTarget) => void;
  onQualify: (target: TestTarget) => void;
  onAdd: (draft: CatalogDraft) => void;
}

const liveProviders = (m: DiscoveredModel) => m.providers.filter((p) => !p.status || p.status === "live");

/** The provider you would most likely pick: cheapest output among JSON-capable ones, else cheapest overall. */
function bestProvider(m: DiscoveredModel): DiscoveredProvider | null {
  const priced = liveProviders(m).filter((p) => p.priceOutput !== null);
  if (priced.length === 0) return null;
  const json = priced.filter((p) => p.supportsJsonMode);
  return [...(json.length > 0 ? json : priced)].sort((a, b) => (a.priceOutput ?? 0) - (b.priceOutput ?? 0))[0];
}

export function DiscoverSection({ onTest, onQualify, onAdd }: Props) {
  const [source, setSource] = useState<Source>("hf-router");
  const [filter, setFilter] = useState("");
  const [hubQuery, setHubQuery] = useState("");
  const [jsonOnly, setJsonOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const enabled = source !== "hf-hub" || hubQuery.length >= 2;
  const discover = useQuery<DiscoverResponse>({
    queryKey: ["/api/admin/llm-models/discover", source, source === "hf-hub" ? hubQuery : "", refreshNonce],
    queryFn: async () => {
      const params = new URLSearchParams({ source });
      if (source === "hf-hub") params.set("q", hubQuery);
      if (refreshNonce > 0) params.set("refresh", "1");
      return (await apiRequest("GET", `/api/admin/llm-models/discover?${params.toString()}`)).json();
    },
    enabled,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const provider: Provider = source === "openai" ? "openai" : "huggingface";

  const rows = useMemo(() => {
    const all = discover.data?.models ?? [];
    const text = source === "hf-hub" ? "" : filter.trim().toLowerCase();
    const cap = maxPrice.trim() === "" ? null : Number(maxPrice);
    return all.filter((m) => {
      if (text && !m.id.toLowerCase().includes(text)) return false;
      if (source !== "hf-router") return true;
      const live = liveProviders(m);
      if (jsonOnly && !live.some((p) => p.supportsJsonMode)) return false;
      if (cap !== null && Number.isFinite(cap) && !live.some((p) => p.priceOutput !== null && p.priceOutput <= cap)) return false;
      return true;
    });
  }, [discover.data, filter, jsonOnly, maxPrice, source]);

  const draftFor = (m: DiscoveredModel, pin: DiscoveredProvider | null): CatalogDraft => {
    const ref = pin ?? bestProvider(m);
    const name = m.id.split("/").pop() ?? m.id;
    return {
      ...EMPTY_DRAFT,
      provider,
      modelName: m.id,
      hfProvider: pin ? pin.provider : "",
      modelKey: suggestModelKey(m.id),
      displayName: name.replace(/[-_]+/g, " "),
      // Unknown JSON support (Hub search, OpenAI): assume yes for OpenAI, no for community models.
      supportsJsonMode: ref?.supportsJsonMode ?? provider === "openai",
      contextLength: ref?.contextLength ? String(ref.contextLength) : "",
      priceInput: ref?.priceInput !== null && ref?.priceInput !== undefined ? String(ref.priceInput) : "",
      priceOutput: ref?.priceOutput !== null && ref?.priceOutput !== undefined ? String(ref.priceOutput) : "",
      notes: `Added from Discover (${SOURCES[source].label}) on ${new Date().toLocaleDateString()}.`,
    };
  };

  const targetFor = (m: DiscoveredModel, pin: DiscoveredProvider | null): TestTarget => ({
    provider,
    model: pin ? `${m.id}:${pin.provider}` : m.id,
    supportsJsonMode: (pin ?? bestProvider(m))?.supportsJsonMode ?? provider === "openai",
  });

  const actions = (m: DiscoveredModel, pin: DiscoveredProvider | null) => (
    <div className="flex items-center gap-1 justify-end">
      <Button variant="ghost" size="icon" title="Try in Playground" onClick={() => onTest(targetFor(m, pin))}>
        <Play className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" title="Qualify: run the real story pipeline" onClick={() => onQualify(targetFor(m, pin))}>
        <FlaskConical className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={() => onAdd(draftFor(m, pin))} title={pin ? `Add, pinned to ${pin.provider}` : "Add to catalog"}>
        <Plus className="h-4 w-4 mr-1" /> Add
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discover models</CardTitle>
        <CardDescription>{SOURCES[source].hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-2">
            <Label htmlFor="disc-source">Source</Label>
            <Select value={source} onValueChange={(v) => { setSource(v as Source); setExpanded(null); }}>
              <SelectTrigger id="disc-source" data-testid="select-discover-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SOURCES) as Source[]).map((s) => (
                  <SelectItem key={s} value={s}>{SOURCES[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="disc-filter">{source === "hf-hub" ? "Search the Hub" : "Filter by name"}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (source === "hf-hub") setHubQuery(filter.trim());
              }}
            >
              <Input
                id="disc-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={source === "hf-hub" ? "e.g. abliterated, roleplay, lumimaid" : "e.g. llama, deepseek, qwen"}
                data-testid="input-discover-filter"
              />
              {source === "hf-hub" ? (
                <Button type="submit" disabled={filter.trim().length < 2}>
                  <Search className="h-4 w-4 mr-2" /> Search
                </Button>
              ) : (
                <Button type="button" variant="outline" size="icon" title="Reload from the provider" onClick={() => setRefreshNonce((n) => n + 1)} disabled={discover.isFetching}>
                  {discover.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              )}
            </form>
          </div>
        </div>

        {source === "hf-router" && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={jsonOnly} onCheckedChange={(c) => setJsonOnly(!!c)} /> JSON mode available
            </label>
            <label className="flex items-center gap-2">
              Max output price
              <Input className="w-24 h-8" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="$ / 1M" />
            </label>
          </div>
        )}

        {discover.isError && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm break-words">
            {errorMessage(discover.error)}
          </div>
        )}

        {!enabled ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Type a search term and press Search.</p>
        ) : discover.isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading models…
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {rows.length} model{rows.length === 1 ? "" : "s"}
              {rows.length > MAX_ROWS ? ` (showing the first ${MAX_ROWS}; filter to narrow down)` : ""}
              {source === "hf-router" ? ". Price and JSON columns show the cheapest suitable provider; expand a row to compare providers." : ""}
            </p>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    {source === "hf-router" && (
                      <>
                        <TableHead>$ in / out per 1M</TableHead>
                        <TableHead>Context</TableHead>
                        <TableHead>JSON mode</TableHead>
                      </>
                    )}
                    {source !== "openai" && <TableHead>Providers</TableHead>}
                    {source === "hf-hub" && <TableHead>Likes</TableHead>}
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No models match.</TableCell>
                    </TableRow>
                  ) : (
                    rows.slice(0, MAX_ROWS).map((m) => {
                      const best = bestProvider(m);
                      const live = liveProviders(m);
                      const isOpen = expanded === m.id;
                      const canExpand = source === "hf-router" && m.providers.length > 0;
                      return (
                        <Fragment key={m.id}>
                          <TableRow data-testid={`row-discover-${m.id}`}>
                            <TableCell className="min-w-[240px]">
                              <button
                                type="button"
                                className="flex items-center gap-1 text-left font-mono text-sm break-all disabled:cursor-default"
                                onClick={() => setExpanded(isOpen ? null : m.id)}
                                disabled={!canExpand}
                              >
                                {canExpand && (isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />)}
                                {m.id}
                              </button>
                              {m.catalogKeys.length > 0 && (
                                <Badge variant="secondary" className="mt-1">In catalog: {m.catalogKeys.join(", ")}</Badge>
                              )}
                            </TableCell>
                            {source === "hf-router" && (
                              <>
                                <TableCell className="whitespace-nowrap">
                                  {best ? `${formatPrice(best.priceInput)} / ${formatPrice(best.priceOutput)}` : "—"}
                                </TableCell>
                                <TableCell>{formatContext(best?.contextLength)}</TableCell>
                                <TableCell>
                                  {live.some((p) => p.supportsJsonMode) ? (
                                    <Badge variant="secondary">Yes</Badge>
                                  ) : (
                                    <Badge variant="outline">No</Badge>
                                  )}
                                </TableCell>
                              </>
                            )}
                            {source !== "openai" && (
                              <TableCell className="text-sm">
                                {source === "hf-hub" ? live.map((p) => p.provider).join(", ") || "none live" : `${live.length} live`}
                              </TableCell>
                            )}
                            {source === "hf-hub" && <TableCell>{m.likes ?? "—"}</TableCell>}
                            <TableCell>{actions(m, null)}</TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={6} className="p-0">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="pl-10">Provider</TableHead>
                                      <TableHead>$ in / out</TableHead>
                                      <TableHead>Context</TableHead>
                                      <TableHead>JSON mode</TableHead>
                                      <TableHead>First token</TableHead>
                                      <TableHead>Tokens/s</TableHead>
                                      <TableHead className="text-right">Pin this provider</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {m.providers.map((p) => (
                                      <TableRow key={p.provider}>
                                        <TableCell className="pl-10 font-mono text-sm">
                                          {p.provider}
                                          {p.status && p.status !== "live" && <Badge variant="outline" className="ml-2">{p.status}</Badge>}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">{formatPrice(p.priceInput)} / {formatPrice(p.priceOutput)}</TableCell>
                                        <TableCell>{formatContext(p.contextLength)}</TableCell>
                                        <TableCell>{p.supportsJsonMode === null ? "—" : p.supportsJsonMode ? "Yes" : "No"}</TableCell>
                                        <TableCell>{p.latencyMs === null ? "—" : `${Math.round(p.latencyMs)} ms`}</TableCell>
                                        <TableCell>{p.throughput === null ? "—" : Math.round(p.throughput)}</TableCell>
                                        <TableCell>{actions(m, p)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
