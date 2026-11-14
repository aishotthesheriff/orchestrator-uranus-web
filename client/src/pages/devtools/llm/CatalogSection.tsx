import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, FlaskConical, Loader2, Pencil, Play, Plus } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  EMPTY_DRAFT,
  PROVIDER_LABELS,
  draftFromModel,
  draftToPayload,
  errorMessage,
  formatPrice,
  formatSeconds,
  formatUsd,
  targetFromCatalog,
  VERDICT_LABELS,
  verdictBadgeVariant,
  verdictOf,
  type CatalogDraft,
  type CatalogModel,
  type CatalogResponse,
  type Provider,
  type PublishState,
  type TestTarget,
} from "./shared";

export const CATALOG_QUERY_KEY = ["/api/admin/llm-models"] as const;

const PUBLISH_BADGE: Record<PublishState, { label: string; variant: "default" | "secondary" | "outline"; hint: string }> = {
  live: { label: "Live", variant: "default", hint: "Players can choose this model." },
  changed: { label: "Unpublished changes", variant: "secondary", hint: "Players still get the previously published version. Publish a release to update it." },
  unpublished: { label: "Not published", variant: "secondary", hint: "Active here, but players cannot see it until a release is published." },
  inactive: { label: "Inactive", variant: "outline", hint: "A draft. Not offered to players." },
};

interface Props {
  /** A draft handed over from Discover ("Add to catalog"). The nonce makes repeats re-open the form. */
  prefill: { nonce: number; draft: CatalogDraft } | null;
  onTest: (target: TestTarget) => void;
  onQualify: (target: TestTarget) => void;
}

export function CatalogSection({ prefill, onTest, onQualify }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const catalog = useQuery<CatalogResponse>({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/llm-models")).json(),
  });
  const models = catalog.data?.models ?? [];

  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [checkAllProgress, setCheckAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<CatalogModel | null>(null);

  useEffect(() => {
    if (!prefill) return;
    setDraft(prefill.draft);
    setEditingKey(null);
    setFormError(null);
  }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => qc.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingKey) {
        const { modelKey: _key, ...changes } = payload;
        return (await apiRequest("PUT", `/api/admin/llm-models/${encodeURIComponent(editingKey)}`, changes)).json();
      }
      return (await apiRequest("POST", "/api/admin/llm-models", payload)).json();
    },
    onSuccess: (saved: CatalogModel) => {
      invalidate();
      toast({ title: editingKey ? "Model updated" : "Model added", description: saved.displayName });
      setDraft(null);
      setEditingKey(null);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const patch = useMutation({
    mutationFn: async ({ modelKey, changes }: { modelKey: string; changes: Record<string, unknown> }) =>
      (await apiRequest("PUT", `/api/admin/llm-models/${encodeURIComponent(modelKey)}`, changes)).json(),
    onSuccess: invalidate,
    onError: (error) => toast({ title: "Update failed", description: errorMessage(error), variant: "destructive" }),
  });

  const deactivate = useMutation({
    mutationFn: async (modelKey: string) => apiRequest("DELETE", `/api/admin/llm-models/${encodeURIComponent(modelKey)}`),
    onSuccess: invalidate,
    onError: (error) => toast({ title: "Deactivate failed", description: errorMessage(error), variant: "destructive" }),
  });

  const runCheck = async (modelKey: string): Promise<boolean> => {
    setChecking((prev) => new Set(prev).add(modelKey));
    try {
      const result = await (await apiRequest("POST", "/api/admin/llm-models/check", { modelKey })).json();
      return Boolean(result.ok);
    } catch (error) {
      toast({ title: `Check failed: ${modelKey}`, description: errorMessage(error), variant: "destructive" });
      return false;
    } finally {
      setChecking((prev) => {
        const next = new Set(prev);
        next.delete(modelKey);
        return next;
      });
    }
  };

  const checkOne = async (modelKey: string) => {
    await runCheck(modelKey);
    invalidate();
  };

  const checkAll = async () => {
    const keys = models.map((m) => m.modelKey);
    let failed = 0;
    setCheckAllProgress({ done: 0, total: keys.length });
    for (let i = 0; i < keys.length; i++) {
      if (!(await runCheck(keys[i]))) failed++;
      setCheckAllProgress({ done: i + 1, total: keys.length });
    }
    setCheckAllProgress(null);
    invalidate();
    toast({
      title: failed === 0 ? "All models responded" : `${failed} of ${keys.length} models failed`,
      variant: failed === 0 ? "default" : "destructive",
    });
  };

  const submit = () => {
    if (!draft) return;
    const { payload, error } = draftToPayload(draft);
    if (error || !payload) {
      setFormError(error ?? "Invalid form");
      return;
    }
    if (!editingKey && models.some((m) => m.modelKey === payload.modelKey)) {
      setFormError(`A model with the key "${payload.modelKey}" already exists. Edit that row, or choose another key.`);
      return;
    }
    setFormError(null);
    save.mutate(payload);
  };

  const pending = useMemo(
    () => models.filter((m) => m.publishState === "unpublished" || m.publishState === "changed").length,
    [models]
  );
  const hasDefault = models.some((m) => m.active === 1 && m.isDefault);

  const set = <K extends keyof CatalogDraft>(field: K, value: CatalogDraft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Story model catalog</CardTitle>
            <CardDescription>
              Models the game may use to write the story. Edits here are drafts: players see them after a release is
              published in the Reference tab.
              {catalog.data?.releaseVersion ? ` Current release: ${catalog.data.releaseVersion}.` : ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={checkAll} disabled={checkAllProgress !== null || models.length === 0}>
              {checkAllProgress ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
              {checkAllProgress ? `Checking ${checkAllProgress.done}/${checkAllProgress.total}…` : "Check all"}
            </Button>
            <Button
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setEditingKey(null);
                setFormError(null);
              }}
              data-testid="button-llm-add"
            >
              <Plus className="h-4 w-4 mr-2" /> Add model
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {catalog.isError && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Couldn't load the catalog: {errorMessage(catalog.error)}
          </div>
        )}
        {catalog.data && !catalog.data.catalogPublished && (
          <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            The current release{catalog.data.releaseVersion ? ` (${catalog.data.releaseVersion})` : ""} was published
            before this catalog existed, so the game reads this table directly: active models are live right away.
            Publish a release in the Reference tab to switch to the normal draft-then-publish flow.
          </div>
        )}
        {pending > 0 && (
          <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            {pending} model{pending === 1 ? " has" : "s have"} changes that players don't see yet. Publish a release in
            the Reference tab to make them live.
          </div>
        )}
        {!catalog.isLoading && !hasDefault && models.length > 0 && (
          <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            No active model is marked as default. The game will use its built-in model (gpt-4o-mini).
          </div>
        )}

        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>$ in / out per 1M</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Last qualify</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {catalog.isLoading ? "Loading…" : "No models yet. Add one, or find one in Discover."}
                  </TableCell>
                </TableRow>
              ) : (
                models.map((m) => {
                  const badge = PUBLISH_BADGE[m.publishState];
                  const check = m.lastCheckSummary?.check;
                  const qualify = m.lastCheckSummary?.qualify;
                  const isChecking = checking.has(m.modelKey);
                  return (
                    <TableRow key={m.modelKey} data-testid={`row-llm-${m.modelKey}`}>
                      <TableCell className="min-w-[220px]">
                        <div className="font-medium flex flex-wrap items-center gap-1.5">
                          {m.displayName}
                          {m.isDefault && <Badge variant="default">Default</Badge>}
                          {m.adult && <Badge variant="outline">18+</Badge>}
                          {!m.supportsJsonMode && <Badge variant="outline" title="No JSON mode: relies on the prompt for valid JSON">no JSON mode</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono break-all">
                          {m.modelKey} → {m.modelName}{m.hfProvider ? `:${m.hfProvider}` : ""}
                        </div>
                        {m.forcedByThemes.length > 0 && (
                          <div className="text-xs text-muted-foreground">Forced by theme: {m.forcedByThemes.join(", ")}</div>
                        )}
                        {m.fallbackModelKey && (
                          <div className="text-xs text-muted-foreground">
                            Falls back to: {models.find((o) => o.modelKey === m.fallbackModelKey)?.displayName ?? m.fallbackModelKey}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{PROVIDER_LABELS[m.provider] ?? m.provider}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatPrice(m.priceInput)} / {formatPrice(m.priceOutput)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant} title={badge.hint}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {isChecking ? (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Checking
                          </span>
                        ) : m.lastCheckOk === null ? (
                          <span className="text-muted-foreground">Not checked</span>
                        ) : m.lastCheckOk ? (
                          <span title={m.lastCheckAt ? new Date(m.lastCheckAt).toLocaleString() : undefined}>
                            <Badge variant="secondary">OK</Badge> {formatSeconds(check?.latencyMs)}
                          </span>
                        ) : (
                          <Badge variant="destructive" title={check?.error}>Failed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {qualify ? (
                          <span title={new Date(qualify.at).toLocaleString()}>
                            <Badge variant={verdictBadgeVariant(verdictOf(qualify))}>
                              {VERDICT_LABELS[verdictOf(qualify)]}
                            </Badge>{" "}
                            {formatSeconds(qualify.turnMs)} · {formatUsd(qualify.costUsd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="icon" title="Health check" onClick={() => checkOne(m.modelKey)} disabled={isChecking}>
                            <Activity className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Try in Playground" onClick={() => onTest(targetFromCatalog(m))}>
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Qualify: run the real story pipeline" onClick={() => onQualify(targetFromCatalog(m))}>
                            <FlaskConical className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => {
                              setDraft(draftFromModel(m));
                              setEditingKey(m.modelKey);
                              setFormError(null);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {m.active === 1 ? (
                            <Button variant="outline" size="sm" className="w-24" onClick={() => setConfirmDeactivate(m)}>
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-24"
                              onClick={() => patch.mutate({ modelKey: m.modelKey, changes: { active: 1 } })}
                              disabled={patch.isPending}
                            >
                              Activate
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Add / edit form */}
      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) { setDraft(null); setEditingKey(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingKey ? `Edit ${editingKey}` : "Add story model"}</DialogTitle>
            <DialogDescription>
              {editingKey
                ? "Changes are a draft until the next release is published."
                : "New models start inactive. Qualify them, then activate and publish."}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="llm-f-provider">Provider</Label>
                  <Select value={draft.provider} onValueChange={(v) => set("provider", v as Provider)}>
                    <SelectTrigger id="llm-f-provider"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="huggingface">Hugging Face</SelectItem>
                      <SelectItem value="nvidia">NVIDIA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-model">Model id</Label>
                  <Input id="llm-f-model" className="font-mono text-sm" value={draft.modelName} onChange={(e) => set("modelName", e.target.value)} placeholder="e.g. deepseek-ai/DeepSeek-V4.1-Flash" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-key">Model key</Label>
                  <Input id="llm-f-key" className="font-mono text-sm" value={draft.modelKey} disabled={editingKey !== null} onChange={(e) => set("modelKey", e.target.value)} placeholder="e.g. deepseek-flash" />
                  <p className="text-xs text-muted-foreground">
                    Stable id saved in player settings. {editingKey ? "Cannot be changed." : "Letters, numbers, dot, dash, underscore."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-name">Display name</Label>
                  <Input id="llm-f-name" value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="Shown to players" />
                </div>
                {draft.provider === "huggingface" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="llm-f-hf">Hugging Face provider (optional)</Label>
                    <Input id="llm-f-hf" className="font-mono text-sm" value={draft.hfProvider} onChange={(e) => set("hfProvider", e.target.value)} placeholder="e.g. novita — leave empty to let Hugging Face choose" />
                    <p className="text-xs text-muted-foreground">
                      Pin a provider when JSON support or price differs between them.
                    </p>
                  </div>
                )}
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="llm-f-desc">Description for players</Label>
                  <Input id="llm-f-desc" value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="One line shown under the model picker" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="llm-f-notes">Admin notes</Label>
                  <Textarea id="llm-f-notes" className="h-20 text-sm" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Test findings, caveats. Not shown to players." />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="llm-f-pin">$ input / 1M</Label>
                  <Input id="llm-f-pin" inputMode="decimal" value={draft.priceInput} onChange={(e) => set("priceInput", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-pout">$ output / 1M</Label>
                  <Input id="llm-f-pout" inputMode="decimal" value={draft.priceOutput} onChange={(e) => set("priceOutput", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-ctx">Context length</Label>
                  <Input id="llm-f-ctx" inputMode="numeric" value={draft.contextLength} onChange={(e) => set("contextLength", e.target.value)} placeholder="tokens" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-max">Min. max tokens</Label>
                  <Input id="llm-f-max" inputMode="numeric" value={draft.maxTokens} onChange={(e) => set("maxTokens", e.target.value)} placeholder="stage default" />
                  <p className="text-xs text-muted-foreground">Raise for reasoning models (e.g. 2000).</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-temp">Temperature</Label>
                  <Input id="llm-f-temp" inputMode="decimal" value={draft.temperature} onChange={(e) => set("temperature", e.target.value)} placeholder="model default" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-f-sort">Sort order</Label>
                  <Input id="llm-f-sort" inputMode="numeric" value={draft.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-f-fallback">Fallback model</Label>
                <select
                  id="llm-f-fallback"
                  className="w-full bg-background border px-3 py-2 rounded-md text-sm"
                  value={draft.fallbackModelKey}
                  onChange={(e) => set("fallbackModelKey", e.target.value)}
                  data-testid="select-llm-fallback"
                >
                  <option value="">Default model</option>
                  {models
                    .filter((o) => o.modelKey !== (editingKey ?? draft.modelKey.trim()))
                    .map((o) => (
                      <option key={o.modelKey} value={o.modelKey}>
                        {o.displayName}
                        {o.adult ? " · 18+" : ""}
                        {o.active === 1 ? "" : " (inactive)"}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Used for a stage when this model fails it twice or its provider is down. For an 18+ model, pick
                  another 18+ model so a failed stage does not become a refusal mid-story.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["supportsJsonMode", "JSON mode", "The provider enforces valid JSON for this model."],
                  ["adult", "18+ capable", "Label only: handles adult content."],
                  ["active", "Active", "Offered to players after the next publish."],
                  ["isDefault", "Default model", "Used when a player has not chosen one. Replaces the current default."],
                ] as const).map(([field, label, hint]) => (
                  <label key={field} className="flex items-start gap-2 text-sm cursor-pointer">
                    <Checkbox className="mt-0.5" checked={draft[field]} onCheckedChange={(c) => set(field, !!c)} />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {draft.isDefault && !draft.active && (
                <p className="text-sm text-amber-600 dark:text-amber-400">A default model must also be active to take effect.</p>
              )}
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDraft(null); setEditingKey(null); }}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending} data-testid="button-llm-save">
              {save.isPending ? "Saving…" : editingKey ? "Save changes" : "Add to catalog"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation */}
      <AlertDialog open={confirmDeactivate !== null} onOpenChange={(open) => { if (!open) setConfirmDeactivate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {confirmDeactivate?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              After the next publish, players who chose this model fall back to the default.
              {confirmDeactivate?.isDefault ? " This is the default model: choose a new default afterwards, or the game uses its built-in model." : ""}
              {confirmDeactivate && confirmDeactivate.forcedByThemes.length > 0
                ? ` It is forced by the theme${confirmDeactivate.forcedByThemes.length > 1 ? "s" : ""} ${confirmDeactivate.forcedByThemes.join(", ")}, which will also fall back to the default.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeactivate) deactivate.mutate(confirmDeactivate.modelKey);
                setConfirmDeactivate(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
