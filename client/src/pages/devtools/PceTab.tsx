import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type { AppSetting, ModStoryTheme, ModVisualStyle } from "./types";

type StoryThemeForm = {
  storyThemeKey: string;
  label: string;
  narratorTemplate: string;
  tags: string;
  active: number;
  /** Catalog key of the story model this theme forces; "" means the player chooses. */
  llmModelKey: string;
};

type VisualStyleForm = {
  category: string;
  visualStyleKey: string;
  label: string;
  exemplifiedBy: string;
  modifiersDiffusion: string;
  modifiersTransformer: string;
  active: number;
};

const createStoryThemeForm = (): StoryThemeForm => ({
  storyThemeKey: "",
  label: "",
  narratorTemplate: "",
  tags: "",
  active: 1,
  llmModelKey: "",
});

const createVisualStyleForm = (): VisualStyleForm => ({
  category: "",
  visualStyleKey: "",
  label: "",
  exemplifiedBy: "",
  modifiersDiffusion: "",
  modifiersTransformer: "",
  active: 1,
});

export function PceTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: settings = [] } = useQuery<AppSetting[]>({
    queryKey: ["/api/settings"],
  });


  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold">Prompt Composition Engine</h2>
        <p className="text-sm text-muted-foreground">
          Toggle the unified JSON turn-generation flow and curate the catalog entries used when composing games.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PCE Prompts</CardTitle>
          <CardDescription>
            PCE prompts (master, narrative, image, actions) are now editable via the Prompts tab.
            They support system/user separation and variable reference panels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Navigate to the <strong>Prompts</strong> tab to edit PCE prompts with full variable reference support.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Catalogs</h3>
        <p className="text-sm text-muted-foreground">
          Manage the curated story themes and visual style presets referenced by the Prompt Composition Engine.
        </p>
      </div>

      <Tabs defaultValue="story-themes" className="space-y-4">
        <TabsList className="w-full max-w-md">
          <TabsTrigger value="story-themes">Story Themes</TabsTrigger>
          <TabsTrigger value="visual-styles">Visual Styles</TabsTrigger>
        </TabsList>
        <TabsContent value="story-themes">
          <StoryThemesSection />
        </TabsContent>
        <TabsContent value="visual-styles">
          <VisualStylesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StoryThemesSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: themes = [], isLoading } = useQuery<ModStoryTheme[]>({
    queryKey: ["/api/admin/mod-story-themes"],
  });

  // Story models a theme can force (Dev Tools → LLM Models → Catalog).
  const { data: llmCatalog } = useQuery<{
    models: Array<{ modelKey: string; displayName: string; active: number; adult: boolean; publishState: string }>;
  }>({
    queryKey: ["/api/admin/llm-models"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/llm-models")).json(),
  });
  const llmModels = llmCatalog?.models ?? [];

  const [selectedTheme, setSelectedTheme] = useState<ModStoryTheme | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<StoryThemeForm>(createStoryThemeForm());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/mod-story-themes"] });
    // The model catalog lists which themes force each model.
    qc.invalidateQueries({ queryKey: ["/api/admin/llm-models"] });
  };

  const createTheme = useMutation({
    mutationFn: async (payload: StoryThemeForm) => {
      const res = await apiRequest("POST", "/api/admin/mod-story-themes", payload);
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      setSelectedTheme(null);
      setIsCreating(true);
      setForm(createStoryThemeForm());
      toast({ title: "Story theme created", description: "The catalog has been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save", description: String(error?.message || error), variant: "destructive" });
    },
  });

  const updateTheme = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: StoryThemeForm }) => {
      const res = await apiRequest("PUT", `/api/admin/mod-story-themes/${encodeURIComponent(id)}`, payload);
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Story theme saved", description: "Changes have been applied." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save", description: String(error?.message || error), variant: "destructive" });
    },
  });

  const deleteTheme = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/mod-story-themes/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      invalidate();
      setSelectedTheme(null);
      setIsCreating(false);
      setForm(createStoryThemeForm());
      toast({ title: "Story theme archived", description: "The entry has been deactivated." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to archive", description: String(error?.message || error), variant: "destructive" });
    },
  });

  const handleSelectTheme = (theme: ModStoryTheme) => {
    setSelectedTheme(theme);
    setIsCreating(false);
    setForm({
      storyThemeKey: theme.storyThemeKey,
      label: theme.label,
      narratorTemplate: theme.narratorTemplate,
      tags: theme.tags || "",
      active: theme.active,
      llmModelKey: theme.llmModelKey ?? "",
    });
  };

  const handleCreateNewTheme = () => {
    setSelectedTheme(null);
    setIsCreating(true);
    setForm(createStoryThemeForm());
  };

  const handleSaveTheme = () => {
    if (!form.storyThemeKey.trim() || !form.label.trim() || !form.narratorTemplate.trim()) {
      toast({
        title: "Missing required fields",
        description: "Story theme key, label, and narrator template are required.",
        variant: "destructive",
      });
      return;
    }

    const payload: StoryThemeForm = {
      storyThemeKey: form.storyThemeKey.trim(),
      label: form.label.trim(),
      narratorTemplate: form.narratorTemplate,
      tags: form.tags.trim(),
      active: form.active,
      llmModelKey: form.llmModelKey,
    };

    if (isCreating) {
      createTheme.mutate(payload);
    } else if (selectedTheme) {
      updateTheme.mutate({ id: selectedTheme.id, payload });
    }
  };

  const isSaving = createTheme.isPending || updateTheme.isPending;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Story Themes</CardTitle>
              <CardDescription>Curate available narrative templates</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCreateNewTheme}>
              New Theme
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {isLoading ? (
              <p className="text-muted-foreground">Loading story themes…</p>
            ) : (
              <div className="space-y-2">
                {themes.map((theme) => (
                  <Button
                    key={theme.id}
                    variant={selectedTheme?.id === theme.id && !isCreating ? "secondary" : "ghost"}
                    className="w-full justify-start text-left"
                    onClick={() => handleSelectTheme(theme)}
                  >
                    <div className="flex flex-col items-start w-full">
                      <div className="font-semibold">{theme.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {theme.storyThemeKey} • {theme.active ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </Button>
                ))}
                {themes.length === 0 && (
                  <p className="text-sm text-muted-foreground">No story themes found.</p>
                )}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {isCreating ? "Create Story Theme" : selectedTheme ? `Edit: ${selectedTheme.label}` : "Select a story theme"}
          </CardTitle>
          <CardDescription>
            {isCreating || selectedTheme
              ? "Populate the metadata and narrator template used by the engine."
              : "Choose an entry on the left to edit or create a new one."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCreating || selectedTheme ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="story-theme-key">Story Theme Key</Label>
                <Input
                  id="story-theme-key"
                  value={form.storyThemeKey}
                  onChange={(event) => setForm({ ...form, storyThemeKey: event.target.value })}
                  placeholder="Unique identifier (e.g. cosmic-noir)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="story-theme-label">Label</Label>
                <Input
                  id="story-theme-label"
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                  placeholder="Display name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="story-theme-narrator">Narrator Template</Label>
                <Textarea
                  id="story-theme-narrator"
                  value={form.narratorTemplate}
                  onChange={(event) => setForm({ ...form, narratorTemplate: event.target.value })}
                  className="h-[220px] font-mono text-sm"
                  placeholder="Template instructions passed to the narrator"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="story-theme-tags">Tags</Label>
                <Input
                  id="story-theme-tags"
                  value={form.tags}
                  onChange={(event) => setForm({ ...form, tags: event.target.value })}
                  placeholder="Comma separated tags"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="story-theme-llm">Forced story model</Label>
                <select
                  id="story-theme-llm"
                  className="w-full bg-background border px-3 py-2 rounded-md text-sm"
                  value={form.llmModelKey}
                  onChange={(event) => setForm({ ...form, llmModelKey: event.target.value })}
                  data-testid="select-theme-forced-model"
                >
                  <option value="">None: the player chooses</option>
                  {llmModels.map((model) => (
                    <option key={model.modelKey} value={model.modelKey}>
                      {model.displayName}
                      {model.adult ? " · 18+" : ""}
                      {model.active === 1 ? "" : " (inactive)"}
                    </option>
                  ))}
                  {form.llmModelKey && !llmModels.some((model) => model.modelKey === form.llmModelKey) && (
                    <option value={form.llmModelKey}>{form.llmModelKey} (not in catalog)</option>
                  )}
                </select>
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    if (!form.llmModelKey) {
                      return "Use this for themes that need a particular model, such as an uncensored one. It overrides the player's choice.";
                    }
                    const model = llmModels.find((m) => m.modelKey === form.llmModelKey);
                    if (!model || model.active !== 1) {
                      return "This model is not active in the catalog, so the theme will not force anything until it is activated and published.";
                    }
                    if (model.publishState !== "live") {
                      return "Takes effect once a release including this model and theme is published.";
                    }
                    return "Players on this theme always get this model; their picker is locked. Publish a release to apply theme changes.";
                  })()}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.active === 1}
                    onCheckedChange={(checked) => setForm({ ...form, active: checked ? 1 : 0 })}
                  />
                  <span className="text-sm">Active</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedTheme && !isCreating && (
                    <Button
                      variant="destructive"
                      onClick={() => deleteTheme.mutate(selectedTheme.id)}
                      disabled={deleteTheme.isPending}
                    >
                      Archive
                    </Button>
                  )}
                  <Button onClick={handleSaveTheme} disabled={isSaving}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a story theme or create a new one to begin editing.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VisualStylesSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: styles = [], isLoading } = useQuery<ModVisualStyle[]>({
    queryKey: ["/api/admin/mod-visual-styles"],
  });

  const [selectedStyle, setSelectedStyle] = useState<ModVisualStyle | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<VisualStyleForm>(createVisualStyleForm());

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/admin/mod-visual-styles"] });

  const createStyle = useMutation({
    mutationFn: async (payload: VisualStyleForm) => {
      const res = await apiRequest("POST", "/api/admin/mod-visual-styles", payload);
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      setSelectedStyle(null);
      setIsCreating(true);
      setForm(createVisualStyleForm());
      toast({ title: "Visual style created", description: "The catalog has been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save", description: String(error?.message || error), variant: "destructive" });
    },
  });

  const updateStyle = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: VisualStyleForm }) => {
      const res = await apiRequest("PUT", `/api/admin/mod-visual-styles/${encodeURIComponent(id)}`, payload);
      return await res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Visual style saved", description: "Changes have been applied." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save", description: String(error?.message || error), variant: "destructive" });
    },
  });

  const deleteStyle = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/mod-visual-styles/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      invalidate();
      setSelectedStyle(null);
      setIsCreating(false);
      setForm(createVisualStyleForm());
      toast({ title: "Visual style archived", description: "The entry has been deactivated." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to archive", description: String(error?.message || error), variant: "destructive" });
    },
  });

  const handleSelectStyle = (style: ModVisualStyle) => {
    setSelectedStyle(style);
    setIsCreating(false);
    setForm({
      category: style.category,
      visualStyleKey: style.visualStyleKey,
      label: style.label,
      exemplifiedBy: style.exemplifiedBy,
      modifiersDiffusion: style.modifiersDiffusion || "",
      modifiersTransformer: style.modifiersTransformer || "",
      active: style.active,
    });
  };

  const handleCreateNewStyle = () => {
    setSelectedStyle(null);
    setIsCreating(true);
    setForm(createVisualStyleForm());
  };

  const handleSaveStyle = () => {
    if (!form.category.trim() || !form.visualStyleKey.trim() || !form.label.trim() || !form.exemplifiedBy.trim()) {
      toast({
        title: "Missing required fields",
        description: "Category, visual style key, label, and exemplar are required.",
        variant: "destructive",
      });
      return;
    }

    const payload: VisualStyleForm = {
      category: form.category.trim(),
      visualStyleKey: form.visualStyleKey.trim(),
      label: form.label.trim(),
      exemplifiedBy: form.exemplifiedBy,
      modifiersDiffusion: form.modifiersDiffusion,
      modifiersTransformer: form.modifiersTransformer,
      active: form.active,
    };

    if (isCreating) {
      createStyle.mutate(payload);
    } else if (selectedStyle) {
      updateStyle.mutate({ id: selectedStyle.id, payload });
    }
  };

  const isSaving = createStyle.isPending || updateStyle.isPending;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Visual Styles</CardTitle>
              <CardDescription>Manage visual style presets and modifiers</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCreateNewStyle}>
              New Style
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {isLoading ? (
              <p className="text-muted-foreground">Loading visual styles…</p>
            ) : (
              <div className="space-y-2">
                {styles.map((style) => (
                  <Button
                    key={style.id}
                    variant={selectedStyle?.id === style.id && !isCreating ? "secondary" : "ghost"}
                    className="w-full justify-start text-left"
                    onClick={() => handleSelectStyle(style)}
                  >
                    <div className="flex flex-col items-start w-full">
                      <div className="font-semibold">{style.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {style.category} • {style.visualStyleKey} • {style.active ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </Button>
                ))}
                {styles.length === 0 && (
                  <p className="text-sm text-muted-foreground">No visual styles found.</p>
                )}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {isCreating ? "Create Visual Style" : selectedStyle ? `Edit: ${selectedStyle.label}` : "Select a visual style"}
          </CardTitle>
          <CardDescription>
            {isCreating || selectedStyle
              ? "Define the reference exemplar and modifiers applied to generated art."
              : "Choose an entry on the left to edit or create a new one."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCreating || selectedStyle ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="visual-style-category">Category</Label>
                <Input
                  id="visual-style-category"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  placeholder="e.g. Illustration"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="visual-style-key">Visual Style Key</Label>
                <Input
                  id="visual-style-key"
                  value={form.visualStyleKey}
                  onChange={(event) => setForm({ ...form, visualStyleKey: event.target.value })}
                  placeholder="Unique identifier"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="visual-style-label">Label</Label>
                <Input
                  id="visual-style-label"
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                  placeholder="Display name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="visual-style-exemplar">Exemplified By</Label>
                <Textarea
                  id="visual-style-exemplar"
                  value={form.exemplifiedBy}
                  onChange={(event) => setForm({ ...form, exemplifiedBy: event.target.value })}
                  className="h-[160px] font-mono text-sm"
                  placeholder="Describe the reference style"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="visual-style-diffusion">Diffusion Modifiers</Label>
                <Textarea
                  id="visual-style-diffusion"
                  value={form.modifiersDiffusion}
                  onChange={(event) => setForm({ ...form, modifiersDiffusion: event.target.value })}
                  className="h-[140px] font-mono text-sm"
                  placeholder="Comma separated modifiers for diffusion backends"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="visual-style-transformer">Transformer Modifiers</Label>
                <Textarea
                  id="visual-style-transformer"
                  value={form.modifiersTransformer}
                  onChange={(event) => setForm({ ...form, modifiersTransformer: event.target.value })}
                  className="h-[140px] font-mono text-sm"
                  placeholder="Comma separated modifiers for transformer backends"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.active === 1}
                    onCheckedChange={(checked) => setForm({ ...form, active: checked ? 1 : 0 })}
                  />
                  <span className="text-sm">Active</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedStyle && !isCreating && (
                    <Button
                      variant="destructive"
                      onClick={() => deleteStyle.mutate(selectedStyle.id)}
                      disabled={deleteStyle.isPending}
                    >
                      Archive
                    </Button>
                  )}
                  <Button onClick={handleSaveStyle} disabled={isSaving}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a visual style or create a new one to begin editing.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PceTab;
