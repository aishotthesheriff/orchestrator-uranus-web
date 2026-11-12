import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, Minus } from "lucide-react";

type ImageModel = {
  modelKey: string;
  provider: "openai" | "huggingface" | string;
  modelName: string;
  hfProvider?: string | null;
  active: number;
  displayName: string;
  description?: string | null;
  sortOrder: number;
  triggerWords?: string | null;
  class?: string | null;
  isDefault?: boolean;
};

function TruncatedText({ text, maxLength = 30 }: { text: string | null | undefined; maxLength?: number }) {
  if (!text) return <span className="text-muted-foreground">-</span>;
  
  const displayText = text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  
  if (text.length > maxLength) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help truncate">{displayText}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs break-words">{text}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return <span>{displayText}</span>;
}

export default function DevToolsImageModels() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["/api/admin/image-models"],
    queryFn: async (): Promise<ImageModel[]> => {
      const res = await apiRequest("GET", "/api/admin/image-models");
      return await res.json();
    },
  });

  const [draft, setDraft] = useState<Partial<ImageModel>>({ provider: "openai", active: 1, sortOrder: 0 });
  const [editingModelKey, setEditingModelKey] = useState<string | null>(null);

  const isEditing = editingModelKey !== null;

  const startEdit = (model: ImageModel) => {
    setDraft({
      modelKey: model.modelKey,
      displayName: model.displayName,
      provider: model.provider,
      modelName: model.modelName,
      hfProvider: model.hfProvider ?? undefined,
      class: model.class ?? undefined,
      triggerWords: model.triggerWords ?? undefined,
      active: model.active,
      sortOrder: model.sortOrder,
      isDefault: model.isDefault ?? false,
    });
    setEditingModelKey(model.modelKey);
  };

  const cancelEdit = () => {
    setDraft({ provider: "openai", active: 1, sortOrder: 0 });
    setEditingModelKey(null);
  };

  // Helper to clear isDefault from all other models
  const clearOtherDefaults = async (currentModelKey: string) => {
    const otherModels = data.filter(m => m.modelKey !== currentModelKey && m.isDefault === true);
    // Update all other models that are currently default to false
    await Promise.all(
      otherModels.map(model =>
        apiRequest("PUT", `/api/admin/image-models/${encodeURIComponent(model.modelKey)}`, { isDefault: false })
      )
    );
  };

  const upsert = useMutation({
    mutationFn: async (payload: Partial<ImageModel> & { modelKey: string }) => {
      // If setting this model as default, first clear all other defaults
      if (payload.isDefault === true) {
        await clearOtherDefaults(payload.modelKey);
      }
      const res = await apiRequest("POST", "/api/admin/image-models", payload);
      return await res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/image-models"] });
      // Only cancel edit if we're not doing "Save As" - keep editing the original
      // If modelKey changed, we're doing Save As, so switch to editing the new one
      if (data?.modelKey && data.modelKey !== editingModelKey) {
        // Save As scenario - start editing the new model
        startEdit(data as ImageModel);
      } else if (!editingModelKey) {
        // Creating new from scratch - clear form
        cancelEdit();
      }
      // Otherwise, keep editing the current model
    },
  });

  const update = useMutation({
    mutationFn: async ({ modelKey, changes }: { modelKey: string; changes: Partial<ImageModel> }) => {
      // If setting this model as default, first clear all other defaults
      if (changes.isDefault === true) {
        await clearOtherDefaults(modelKey);
      }
      const res = await apiRequest("PUT", `/api/admin/image-models/${encodeURIComponent(modelKey)}`, changes);
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/image-models"] });
      cancelEdit();
    },
  });

  const deactivate = useMutation({
    mutationFn: async (modelKey: string) => {
      await apiRequest("DELETE", `/api/admin/image-models/${encodeURIComponent(modelKey)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/image-models"] }),
  });

  const sorted = useMemo(
    () => [...data].sort((a, b) => a.sortOrder - b.sortOrder || a.modelKey.localeCompare(b.modelKey)),
    [data]
  );

  return (
    <TooltipProvider>
    <Card>
      <CardHeader>
        <CardTitle>Image Models</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
          {/* Create/Edit Form */}
          <div className="border rounded-lg p-4 bg-muted/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">
                {isEditing ? `Edit Image Model: ${editingModelKey}` : "Add New Image Model"}
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="model-key">Model Key *</Label>
                <Input
                  id="model-key"
                  placeholder="e.g. my-model-key"
                  value={draft.modelKey || ""}
                  onChange={(e) => setDraft({ ...draft, modelKey: e.target.value })}
                  className={isEditing ? "" : ""}
                />
                {isEditing && (
                  <p className="text-xs text-muted-foreground">
                    {draft.modelKey === editingModelKey
                      ? "Model key cannot be changed. Change it to use 'Save As' to create a copy."
                      : "Changed from original. Use 'Save As' to create a new model with this key."}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name *</Label>
                <Input
                  id="display-name"
                  placeholder="e.g. My Model"
                  value={draft.displayName || ""}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider">Provider *</Label>
          <Select value={draft.provider || "openai"} onValueChange={(v) => setDraft({ ...draft, provider: v as any })}>
                  <SelectTrigger id="provider">
                    <SelectValue placeholder="Provider" />
                  </SelectTrigger>
            <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="huggingface">Hugging Face</SelectItem>
            </SelectContent>
          </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-name">Model Name *</Label>
                <Input
                  id="model-name"
                  placeholder="e.g. gpt-image-1-mini"
                  value={draft.modelName || ""}
                  onChange={(e) => setDraft({ ...draft, modelName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hf-provider">HF Provider</Label>
                <Input
                  id="hf-provider"
                  placeholder="e.g. fal-ai (optional)"
                  value={draft.hfProvider || ""}
                  onChange={(e) => setDraft({ ...draft, hfProvider: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="class">Class</Label>
                <Input
                  id="class"
                  placeholder="e.g. diffuser"
                  value={draft.class || ""}
                  onChange={(e) => setDraft({ ...draft, class: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trigger-words">Trigger Words</Label>
                <Input
                  id="trigger-words"
                  placeholder="Comma-separated (max 500 chars)"
                  value={draft.triggerWords || ""}
                  onChange={(e) => setDraft({ ...draft, triggerWords: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="active">Active</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="active"
                    checked={(draft.active ?? 1) === 1}
                    onCheckedChange={(checked) => setDraft({ ...draft, active: checked ? 1 : 0 })}
                  />
                  <Label htmlFor="active" className="cursor-pointer font-normal">
                    Model is active
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="is-default">Set as Default Model</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, this model will be used as the default for new games. Only one model should be set as default.
                </p>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is-default"
                    checked={draft.isDefault ?? false}
                    onCheckedChange={(checked) => setDraft({ ...draft, isDefault: !!checked })}
                  />
                  <Label htmlFor="is-default" className="cursor-pointer font-normal">
                    Use as default image model
                  </Label>
                </div>
              </div>
            </div>
            
            {/* Save Buttons */}
            <div className="flex gap-2 mt-4 pt-4 border-t">
              {isEditing && (
                <>
                  <Button 
                    onClick={() => {
                      if (!draft.modelKey) return;
                      // Save - update existing model
                      update.mutate({ 
                        modelKey: editingModelKey!, 
                        changes: { ...draft, modelKey: editingModelKey! } as Partial<ImageModel>
                      });
                    }}
                    disabled={!draft.modelKey || update.isPending}
                  >
                    {update.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      if (!draft.modelKey || draft.modelKey === editingModelKey) return;
                      // Save As - create new model with new key
                      const { modelKey: _, ...restDraft } = draft;
                      upsert.mutate({ ...restDraft, modelKey: draft.modelKey! } as any);
                    }}
                    disabled={!draft.modelKey || draft.modelKey === editingModelKey || upsert.isPending}
                  >
                    {upsert.isPending ? "Creating..." : "Save As"}
                  </Button>
                </>
              )}
              {!isEditing && (
                <Button 
                  onClick={() => {
                    if (!draft.modelKey) return;
                    // Create new model
                    upsert.mutate(draft as any);
                  }}
                  disabled={!draft.modelKey || upsert.isPending}
                >
                  {upsert.isPending ? "Saving..." : "Save"}
                </Button>
              )}
            </div>
          </div>

          {/* Models Table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium">Model Key</th>
                    <th className="text-left p-3 text-sm font-medium">Display Name</th>
                    <th className="text-left p-3 text-sm font-medium">Provider</th>
                    <th className="text-left p-3 text-sm font-medium min-w-[200px]">Model Name</th>
                    <th className="text-left p-3 text-sm font-medium">HF Provider</th>
                    <th className="text-left p-3 text-sm font-medium">Class</th>
                    <th className="text-left p-3 text-sm font-medium">Trigger Words</th>
                    <th className="text-left p-3 text-sm font-medium">Is Default</th>
                    <th className="text-right p-3 text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        No image models found. Create one above.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((m) => {
                      const isBeingEdited = isEditing && editingModelKey === m.modelKey;
                      return (
                        <tr 
                          key={m.modelKey} 
                          className={`hover:bg-muted/30 ${
                            isBeingEdited 
                              ? "bg-primary/20 border-l-4 border-l-primary ring-2 ring-primary/30" 
                              : ""
                          }`}
                        >
                          <td className="p-3 text-sm font-mono">{m.modelKey}</td>
                          <td className="p-3 text-sm">{m.displayName}</td>
                          <td className="p-3 text-sm">
                            <span className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs font-medium">
                              {m.provider}
                            </span>
                          </td>
                          <td className="p-3 text-sm">
                            <TruncatedText text={m.modelName} maxLength={35} />
                          </td>
                          <td className="p-3 text-sm">
                            {m.hfProvider ? (
                              <span className="text-xs">{m.hfProvider}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3 text-sm">
                            {m.class ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                                {m.class}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3 text-sm">
                            <TruncatedText text={m.triggerWords} maxLength={25} />
                          </td>
                          <td className="p-3 text-sm">
                            {m.isDefault ? (
                              <Check className="h-5 w-5 text-green-500" />
                            ) : (
                              <Minus className="h-5 w-5 text-muted-foreground" />
                            )}
                          </td>
                          <td className="p-3 text-sm">
                            <div className="flex items-center gap-2 justify-end">
                              {isBeingEdited && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={cancelEdit}
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  Cancel
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (isBeingEdited) {
                                    // Already editing, button disabled
                                    return;
                                  } else {
                                    startEdit(m);
                                  }
                                }}
                                disabled={isBeingEdited}
                              >
                                {isBeingEdited ? "Editing..." : "Edit"}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={isBeingEdited}
                                  >
                                    Delete
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Image Model</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "{m.displayName}"? This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deactivate.mutate(m.modelKey)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </td>
                        </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
        </div>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
