import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Loader2,
  Play,
  RefreshCw,
  Star,
  ChevronRight,
  ChevronDown,
  Zap,
  GitBranch,
  Clock,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Code2,
  FileText,
  Image as ImageIcon,
  List,
  Settings,
  Database,
  Eye,
  EyeOff,
  BarChart3,
} from "lucide-react";

import type { ParsedTestRun, ParsedTestScenario, PceTestRun } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { TraceLink, type TraceRef } from "./components/TraceLink";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ============================================================================
// Types
// ============================================================================

type StageMetadataLike = {
  stage: string;
  template: string;
  model?: string;
  prompt?: string;
  rawResponse?: string | null;
  fallbackUsed?: boolean;
  error?: string | null;
  durationMs?: number;
  timestamp?: string;
  extras?: Record<string, unknown>;
};

type StageResultLike<T = unknown> = {
  ok: boolean;
  output: T | null;
  metadata: StageMetadataLike[];
};

type InspectorStageResults = {
  scenarioId: string;
  scenarioName: string;
  playerAction: string;
  selections?: {
    theme?: string;
    style?: string;
    imageModelKey?: string;
  };
  result?: {
    master: StageResultLike;
    narrative: StageResultLike<{ narration?: string; toneHints?: string[] }>;
    image: StageResultLike<{ imagePrompt?: string; modelOverrides?: Record<string, unknown> }>;
    actions: StageResultLike<{ actions?: ActionRecord[] }>;
    promptChain: StageMetadataLike[];
    fallbackUsed?: boolean;
  };
  checks?: Record<string, unknown>[];
  triggeredEvent?: Record<string, unknown> | null;
  executedAt?: string;
  /** Where the run is in LangSmith; absent when it was made with tracing off. */
  trace?: TraceRef;
};

type ActionRecord = {
  action: string;
  summary?: string;
  risk?: string;
  intent?: string;
};

type InspectorRun = ParsedTestRun & { stageResults: InspectorStageResults | null };

type InspectionStage = "master" | "narrative" | "image" | "actions";

/** Select value meaning "let the game choose the story model". */
const DEFAULT_STORY_MODEL = "__default__";

type StageConfig = {
  id: InspectionStage;
  label: string;
  shortLabel: string;
  icon: typeof Code2;
  color: string;
  bgColor: string;
  borderColor: string;
  dependencies: InspectionStage[];
  outputDescription: string;
};

const STAGE_CONFIGS: Record<InspectionStage, StageConfig> = {
  master: {
    id: "master",
    label: "Master Enrichment",
    shortLabel: "Master",
    icon: Code2,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    borderColor: "border-blue-200 dark:border-blue-800",
    dependencies: [],
    outputDescription: "Context variables & enrichment",
  },
  narrative: {
    id: "narrative",
    label: "Narrative Generation",
    shortLabel: "Narrative",
    icon: FileText,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    borderColor: "border-purple-200 dark:border-purple-800",
    dependencies: ["master"],
    outputDescription: "6-7 sentence story text",
  },
  image: {
    id: "image",
    label: "Image Prompt",
    shortLabel: "Image",
    icon: ImageIcon,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/30",
    borderColor: "border-green-200 dark:border-green-800",
    dependencies: ["master", "narrative"],
    outputDescription: "Visual scene description",
  },
  actions: {
    id: "actions",
    label: "Action Suggestions",
    shortLabel: "Actions",
    icon: List,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    borderColor: "border-orange-200 dark:border-orange-800",
    dependencies: ["master", "narrative"],
    outputDescription: "Contextual player options",
  },
};

// ============================================================================
// Main Component
// ============================================================================

export function PCEInspectorTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Selection state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [focusedStage, setFocusedStage] = useState<InspectionStage | null>(null);

  // Execution controls
  const [executionMode, setExecutionMode] = useState<"full" | "single-stage">("full");
  const [targetStage, setTargetStage] = useState<InspectionStage>("narrative");
  const [mockDataSource, setMockDataSource] = useState<"generate" | "from-run" | "custom">("generate");
  const [sourceRunId, setSourceRunId] = useState<string | null>(null);
  const [customMockData, setCustomMockData] = useState<{ masterEnrichment?: any; narrative?: string } | null>(null);
  // Story model for the run. Empty = the default (theme-forced or system default).
  const [llmModelKey, setLlmModelKey] = useState<string>(DEFAULT_STORY_MODEL);

  // UI state
  const [showPipelineView, setShowPipelineView] = useState(true);
  const [showVariables, setShowVariables] = useState(true);
  const [comparisonRunId, setComparisonRunId] = useState<string | null>(null);

  // Data fetching
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery<ParsedTestScenario[]>({
    queryKey: ["/api/admin/pce-inspector/scenarios"],
  });

  const { data: llmCatalog } = useQuery<{ models: Array<{ modelKey: string; displayName: string; active: number }> }>({
    queryKey: ["/api/admin/llm-models"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/llm-models")).json(),
  });

  const { data: runsRaw = [], isLoading: runsLoading } = useQuery<ParsedTestRun[]>({
    queryKey: ["/api/admin/pce-inspector/runs", { scenarioId: selectedScenarioId ?? undefined }],
    enabled: Boolean(selectedScenarioId),
  });

  const runs: InspectorRun[] = useMemo(
    () => runsRaw.map((run) => ({ ...run, stageResults: parseStageResults(run.stageResults) })),
    [runsRaw]
  );

  // Auto-select first scenario and run
  useEffect(() => {
    if (!selectedScenarioId && scenarios.length > 0) {
      setSelectedScenarioId(scenarios[0].id);
    }
  }, [scenarios, selectedScenarioId]);

  useEffect(() => {
    if (selectedScenarioId && runs.length > 0 && !selectedRunId) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedScenarioId, selectedRunId]);

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId) ?? null;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const comparisonRun = runs.find((r) => r.id === comparisonRunId) ?? null;

  // Mutations
  const runTestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedScenarioId) throw new Error("Select a scenario first");

      const requestBody: any = {
        scenarioId: selectedScenarioId,
        mode: executionMode,
      };
      if (llmModelKey !== DEFAULT_STORY_MODEL) {
        requestBody.llmModelKey = llmModelKey;
      }

      if (executionMode === "single-stage") {
        requestBody.targetStage = targetStage;

        if (mockDataSource === "from-run" && sourceRunId) {
          requestBody.useDataFromRunId = sourceRunId;
        } else if (mockDataSource === "custom" && customMockData) {
          requestBody.mockData = customMockData;
        }
      }

      const res = await apiRequest("POST", "/api/admin/pce-inspector/test/run", requestBody);
      return (await res.json()) as ParsedTestRun;
    },
    onSuccess: async (run) => {
      const modeText = executionMode === "full" ? "Full pipeline" : `${targetStage} stage`;
      toast({
        title: `✓ ${modeText} completed`,
        description: `${run.durationMs ? (run.durationMs / 1000).toFixed(1) + "s" : "N/A"} · ${run.estimatedCostUsd ? "$" + run.estimatedCostUsd.toFixed(4) : "N/A"}`,
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/pce-inspector/runs", { scenarioId: selectedScenarioId ?? undefined }],
      });
      setSelectedRunId(run.id);
    },
    onError: (error) => {
      toast({
        title: "Failed to execute test",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  const updateRunMutation = useMutation({
    mutationFn: async (updates: Partial<PceTestRun>) => {
      if (!selectedRun) throw new Error("No run selected");
      const res = await apiRequest("PUT", `/api/admin/pce-inspector/runs/${selectedRun.id}`, updates);
      return (await res.json()) as ParsedTestRun;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/pce-inspector/runs", { scenarioId: selectedScenarioId ?? undefined }],
      });
    },
  });

  const handleRunTest = () => {
    if (!selectedScenarioId || runTestMutation.isPending) return;
    runTestMutation.mutate();
  };

  const handleToggleStar = () => {
    if (!selectedRun) return;
    updateRunMutation.mutate({ starred: !selectedRun.starred });
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">PCE Inspector</h2>
          <p className="text-sm text-muted-foreground">
            Visualize and test the Prompt Composition Engine pipeline
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPipelineView(!showPipelineView)}
          >
            {showPipelineView ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showPipelineView ? "Hide" : "Show"} Pipeline
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/pce-inspector/scenarios"] })}
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", scenariosLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        {/* Left Sidebar - Scenarios & Controls */}
        <Card className="col-span-3 flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Test Scenarios</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
            <ScrollArea className="flex-1 -mr-4 pr-4">
              <div className="space-y-1">
                {scenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    onClick={() => setSelectedScenarioId(scenario.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                      selectedScenarioId === scenario.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className="font-medium">{scenario.name}</div>
                    {scenario.description && (
                      <div className="text-xs opacity-80 mt-0.5 line-clamp-1">{scenario.description}</div>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>

            <Separator />

            {/* Execution Controls */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Execution Mode</Label>
                <Select value={executionMode} onValueChange={(v) => setExecutionMode(v as any)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5" />
                        Full Pipeline
                      </div>
                    </SelectItem>
                    <SelectItem value="single-stage">
                      <div className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5" />
                        Single Stage
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {executionMode === "single-stage" && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Target Stage</Label>
                    <Select value={targetStage} onValueChange={(v) => setTargetStage(v as InspectionStage)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(STAGE_CONFIGS).map((config) => {
                          const Icon = config.icon;
                          return (
                            <SelectItem key={config.id} value={config.id}>
                              <div className="flex items-center gap-2">
                                <Icon className={cn("h-3.5 w-3.5", config.color)} />
                                {config.label}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {STAGE_CONFIGS[targetStage].dependencies.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5">Upstream Data</Label>
                      <Select value={mockDataSource} onValueChange={(v) => setMockDataSource(v as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="generate">Auto-generate</SelectItem>
                          <SelectItem value="from-run">From previous run</SelectItem>
                          <SelectItem value="custom">Custom data</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {mockDataSource === "from-run" && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5">Source Run</Label>
                      <Select value={sourceRunId || ""} onValueChange={setSourceRunId}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select run..." />
                        </SelectTrigger>
                        <SelectContent>
                          {runs.slice(0, 10).map((run) => (
                            <SelectItem key={run.id} value={run.id}>
                              <div className="flex items-center gap-2">
                                <StatusBadge status={run.status} compact />
                                <span className="text-xs">
                                  {format(new Date(run.executedAt), "HH:mm:ss")}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {mockDataSource === "custom" && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full">
                          <Settings className="h-3.5 w-3.5 mr-2" />
                          Edit Custom Data
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Custom Mock Data</DialogTitle>
                          <DialogDescription>
                            Provide custom upstream data for testing the {STAGE_CONFIGS[targetStage].label} stage.
                          </DialogDescription>
                        </DialogHeader>
                        <CustomDataEditor targetStage={targetStage} onDataChange={setCustomMockData} />
                      </DialogContent>
                    </Dialog>
                  )}
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="pce-story-model">Story model</Label>
                <Select value={llmModelKey} onValueChange={setLlmModelKey}>
                  <SelectTrigger id="pce-story-model" data-testid="select-pce-story-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_STORY_MODEL}>Default (as the game would choose)</SelectItem>
                    {(llmCatalog?.models ?? []).map((m) => (
                      <SelectItem key={m.modelKey} value={m.modelKey}>
                        {m.displayName}{m.active === 1 ? "" : " (draft)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleRunTest} disabled={runTestMutation.isPending} className="w-full">
                {runTestMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Test
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Center - Pipeline Visualization & Results */}
        <div className="col-span-9 flex flex-col gap-4 min-h-0">
          {/* Pipeline Flow Diagram */}
          {showPipelineView && selectedRun && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Pipeline Flow</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {selectedRun.durationMs ? `${(selectedRun.durationMs / 1000).toFixed(2)}s` : "N/A"}
                    <DollarSign className="h-3.5 w-3.5 ml-2" />
                    {selectedRun.estimatedCostUsd ? `$${selectedRun.estimatedCostUsd.toFixed(4)}` : "N/A"}
                    <TraceLink trace={selectedRun.stageResults?.trace} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <PipelineFlowDiagram
                  run={selectedRun}
                  focusedStage={focusedStage}
                  onStageClick={setFocusedStage}
                />
              </CardContent>
            </Card>
          )}

          {/* Stage Results */}
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Test Results</CardTitle>
                  {selectedRun && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleToggleStar}
                      className={cn(selectedRun.starred && "text-yellow-500")}
                    >
                      <Star className={cn("h-4 w-4", selectedRun.starred && "fill-current")} />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowVariables(!showVariables)}
                  >
                    <Code2 className="h-3.5 w-3.5 mr-2" />
                    {showVariables ? "Hide" : "Show"} Variables
                  </Button>
                  <Select value={comparisonRunId || "none"} onValueChange={(v) => setComparisonRunId(v === "none" ? null : v)}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Compare with..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No comparison</SelectItem>
                      {runs.filter(r => r.id !== selectedRunId).slice(0, 5).map((run) => (
                        <SelectItem key={run.id} value={run.id}>
                          {format(new Date(run.executedAt), "HH:mm:ss")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0">
              {selectedRun && (
                <StageInspector
                  run={selectedRun}
                  comparisonRun={comparisonRun}
                  showVariables={showVariables}
                  focusedStage={focusedStage}
                  onStageFocus={setFocusedStage}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Pipeline Flow Diagram
// ============================================================================

function PipelineFlowDiagram({
  run,
  focusedStage,
  onStageClick,
}: {
  run: InspectorRun;
  focusedStage: InspectionStage | null;
  onStageClick: (stage: InspectionStage | null) => void;
}) {
  const result = run.stageResults?.result;

  const getStageStatus = (stage: InspectionStage): "success" | "error" | "idle" => {
    if (!result) return "idle";
    const stageResult = result[stage];
    if (!stageResult) return "idle";
    return stageResult.ok ? "success" : "error";
  };

  const getStageDuration = (stage: InspectionStage): number | null => {
    if (!result) return null;
    // A stage lists every attempt (retry, fallback); the last one produced the output.
    const metadata = result[stage]?.metadata?.at(-1);
    return metadata?.durationMs ?? null;
  };

  return (
    <div className="py-6">
      {/* Master Stage */}
      <div className="flex items-center justify-center">
        <StageNode
          config={STAGE_CONFIGS.master}
          status={getStageStatus("master")}
          duration={getStageDuration("master")}
          focused={focusedStage === "master"}
          onClick={() => onStageClick(focusedStage === "master" ? null : "master")}
        />
      </div>

      {/* Arrow down */}
      <div className="flex justify-center my-2">
        <div className="h-8 w-0.5 bg-border" />
      </div>

      {/* Narrative Stage */}
      <div className="flex items-center justify-center">
        <StageNode
          config={STAGE_CONFIGS.narrative}
          status={getStageStatus("narrative")}
          duration={getStageDuration("narrative")}
          focused={focusedStage === "narrative"}
          onClick={() => onStageClick(focusedStage === "narrative" ? null : "narrative")}
        />
      </div>

      {/* Split arrows */}
      <div className="flex justify-center my-2">
        <div className="relative w-64 h-8">
          {/* Vertical line */}
          <div className="absolute left-1/2 top-0 h-4 w-0.5 bg-border -translate-x-1/2" />
          {/* Horizontal line */}
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-border" />
          {/* Left down arrow */}
          <div className="absolute left-1/4 top-4 h-4 w-0.5 bg-border -translate-x-1/2" />
          {/* Right down arrow */}
          <div className="absolute left-3/4 top-4 h-4 w-0.5 bg-border -translate-x-1/2" />
        </div>
      </div>

      {/* Parallel Stages: Image & Actions */}
      <div className="grid grid-cols-2 gap-8">
        <div className="flex justify-center">
          <StageNode
            config={STAGE_CONFIGS.image}
            status={getStageStatus("image")}
            duration={getStageDuration("image")}
            focused={focusedStage === "image"}
            onClick={() => onStageClick(focusedStage === "image" ? null : "image")}
          />
        </div>
        <div className="flex justify-center">
          <StageNode
            config={STAGE_CONFIGS.actions}
            status={getStageStatus("actions")}
            duration={getStageDuration("actions")}
            focused={focusedStage === "actions"}
            onClick={() => onStageClick(focusedStage === "actions" ? null : "actions")}
          />
        </div>
      </div>
    </div>
  );
}

function StageNode({
  config,
  status,
  duration,
  focused,
  onClick,
}: {
  config: StageConfig;
  status: "success" | "error" | "idle";
  duration: number | null;
  focused: boolean;
  onClick: () => void;
}) {
  const Icon = config.icon;
  const StatusIcon = status === "success" ? CheckCircle2 : status === "error" ? XCircle : AlertCircle;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative group",
        "px-6 py-4 rounded-lg border-2 transition-all",
        "hover:shadow-lg hover:scale-105",
        focused && "ring-2 ring-primary ring-offset-2 shadow-lg scale-105",
        config.bgColor,
        config.borderColor
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-md bg-background/50", config.color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-left">
          <div className="font-semibold text-sm">{config.shortLabel}</div>
          <div className="text-xs text-muted-foreground">{config.outputDescription}</div>
        </div>
        <StatusIcon
          className={cn(
            "h-4 w-4",
            status === "success" && "text-green-600",
            status === "error" && "text-destructive",
            status === "idle" && "text-muted-foreground"
          )}
        />
      </div>
      {duration && (
        <div className="absolute -bottom-2 right-2 px-2 py-0.5 rounded-full bg-background border text-[10px] font-medium">
          {duration}ms
        </div>
      )}
    </button>
  );
}

// ============================================================================
// Stage Inspector
// ============================================================================

function StageInspector({
  run,
  comparisonRun,
  showVariables,
  focusedStage,
  onStageFocus,
}: {
  run: InspectorRun;
  comparisonRun: InspectorRun | null;
  showVariables: boolean;
  focusedStage: InspectionStage | null;
  onStageFocus: (stage: InspectionStage | null) => void;
}) {
  const result = run.stageResults?.result;
  const compResult = comparisonRun?.stageResults?.result;

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No results available</p>
        </div>
      </div>
    );
  }

  const stages: InspectionStage[] = ["master", "narrative", "image", "actions"];
  const displayStages = focusedStage ? [focusedStage] : stages;

  return (
    <ScrollArea className="h-full -mr-4 pr-4">
      <div className="space-y-6">
        {displayStages.map((stageId) => {
          const config = STAGE_CONFIGS[stageId];
          const stageResult = result[stageId];
          const compStageResult = compResult?.[stageId];

          return (
            <StageResultCard
              key={stageId}
              config={config}
              result={stageResult}
              comparisonResult={compStageResult}
              showVariables={showVariables}
              focused={focusedStage === stageId}
              onToggleFocus={() => onStageFocus(focusedStage === stageId ? null : stageId)}
            />
          );
        })}
      </div>
    </ScrollArea>
  );
}

function StageResultCard({
  config,
  result,
  comparisonResult,
  showVariables,
  focused,
  onToggleFocus,
}: {
  config: StageConfig;
  result: StageResultLike | undefined;
  comparisonResult: StageResultLike | undefined;
  showVariables: boolean;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const Icon = config.icon;

  if (!result) {
    return null;
  }

  // A stage lists every attempt (retry, fallback); the last one produced the output.
  const metadata = result.metadata?.at(-1);

  return (
    <Card className={cn("transition-all", focused && "ring-2 ring-primary")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-md", config.bgColor)}>
              <Icon className={cn("h-4 w-4", config.color)} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">{config.label}</CardTitle>
              <CardDescription className="text-xs">{config.outputDescription}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {result.ok ? (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Success
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Error
              </Badge>
            )}
            {metadata?.durationMs && (
              <Badge variant="secondary" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {metadata.durationMs}ms
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {/* Output Display */}
          <div>
            <Label className="text-xs font-semibold mb-2">Output</Label>
            <StageOutput stageId={config.id} output={result.output ?? null} />
          </div>

          {/* Comparison */}
          {comparisonResult ? (
            <div>
              <Label className="text-xs font-semibold mb-2 flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5" />
                Comparison
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Current Run</div>
                  <StageOutput stageId={config.id} output={result.output ?? null} compact />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Comparison Run</div>
                  <StageOutput stageId={config.id} output={comparisonResult.output ?? null} compact />
                </div>
              </div>
            </div>
          ) : null}

          {/* Variables */}
          {showVariables && result.output && typeof result.output === "object" ? (
            <div>
              <Label className="text-xs font-semibold mb-2 flex items-center gap-2">
                <Database className="h-3.5 w-3.5" />
                Variables & Data
              </Label>
              <div className="rounded-md border bg-muted/30 p-3">
                <JsonTree data={result.output} />
              </div>
            </div>
          ) : null}

          {/* Metadata */}
          {metadata && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <Code2 className="h-3.5 w-3.5 mr-2" />
                  Show Template & Prompt Details
                  <ChevronDown className="h-3.5 w-3.5 ml-auto" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <Label className="text-xs text-muted-foreground">Template</Label>
                    <div className="font-mono mt-1">{metadata.template}</div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <div className="font-mono mt-1">{metadata.model || "N/A"}</div>
                  </div>
                </div>
                {metadata.prompt && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2">Full Prompt</Label>
                    <ScrollArea className="h-48 rounded-md border bg-muted/30 p-3">
                      <pre className="text-[11px] font-mono whitespace-pre-wrap">{metadata.prompt}</pre>
                    </ScrollArea>
                  </div>
                )}
                {metadata.rawResponse && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2">Raw Response</Label>
                    <ScrollArea className="h-48 rounded-md border bg-muted/30 p-3">
                      <pre className="text-[11px] font-mono whitespace-pre-wrap">{metadata.rawResponse}</pre>
                    </ScrollArea>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ============================================================================
// Stage Output Renderers
// ============================================================================

function StageOutput({
  stageId,
  output,
  compact,
}: {
  stageId: InspectionStage;
  output: any;
  compact?: boolean;
}) {
  if (!output) {
    return <div className="text-sm text-muted-foreground italic">No output</div>;
  }

  switch (stageId) {
    case "master":
      return <MasterOutput data={output} compact={compact} />;
    case "narrative":
      return <NarrativeOutput data={output} compact={compact} />;
    case "image":
      return <ImageOutput data={output} compact={compact} />;
    case "actions":
      return <ActionsOutput data={output} compact={compact} />;
    default:
      return <JsonTree data={output} />;
  }
}

function MasterOutput({ data, compact }: { data: any; compact?: boolean }) {
  const enrichment = data?.enrichment || data;
  const flatVars = data?.flattened || {};

  if (compact) {
    const keyCount = Object.keys(flatVars).length;
    return (
      <div className="text-sm rounded-md border bg-muted/30 p-2">
        <div className="font-medium text-xs text-muted-foreground">
          {keyCount} variables generated
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(flatVars).slice(0, 8).map(([key, value]) => (
          <div key={key} className="rounded-md border bg-muted/30 p-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {key}
            </div>
            <div className="text-xs mt-1 font-mono line-clamp-2">{String(value)}</div>
          </div>
        ))}
      </div>
      {Object.keys(flatVars).length > 8 && (
        <div className="text-xs text-muted-foreground text-center">
          + {Object.keys(flatVars).length - 8} more variables
        </div>
      )}
    </div>
  );
}

function NarrativeOutput({ data, compact }: { data: any; compact?: boolean }) {
  const narration = data?.narration || data;

  if (compact) {
    return (
      <div className="text-sm rounded-md border bg-muted/30 p-2 line-clamp-2">
        {narration}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{narration}</div>
    </div>
  );
}

function ImageOutput({ data, compact }: { data: any; compact?: boolean }) {
  const imagePrompt = data?.imagePrompt || data;

  if (compact) {
    return (
      <div className="text-sm rounded-md border bg-muted/30 p-2 line-clamp-2">
        {imagePrompt}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <div className="text-sm leading-relaxed whitespace-pre-wrap font-mono">{imagePrompt}</div>
    </div>
  );
}

function ActionsOutput({ data, compact }: { data: any; compact?: boolean }) {
  const actions = data?.actions || [];

  if (compact) {
    return (
      <div className="text-sm rounded-md border bg-muted/30 p-2">
        {actions.length} actions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {actions.map((action: ActionRecord, i: number) => (
        <div key={i} className="rounded-md border bg-muted/30 p-3">
          <div className="font-medium text-sm">{action.action}</div>
          {action.summary && (
            <div className="text-xs text-muted-foreground mt-1">{action.summary}</div>
          )}
          {action.risk && (
            <Badge variant="outline" className="mt-2 text-[10px]">
              Risk: {action.risk}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// JSON Tree Viewer
// ============================================================================

function JsonTree({ data, depth = 0 }: { data: any; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (data === null || data === undefined) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof data !== "object") {
    return <span className="text-xs font-mono">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-xs font-mono text-muted-foreground">[]</span>;
    }

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs font-mono hover:underline"
        >
          [{data.length}] {expanded ? "▼" : "▶"}
        </button>
        {expanded && (
          <div className="ml-4 border-l-2 border-muted pl-3 mt-1 space-y-1">
            {data.map((item, i) => (
              <div key={i}>
                <span className="text-xs text-muted-foreground">[{i}]</span>{" "}
                <JsonTree data={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <span className="text-xs font-mono text-muted-foreground">{"{}"}</span>;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-mono hover:underline"
      >
        {"{"}{entries.length}{"}"} {expanded ? "▼" : "▶"}
      </button>
      {expanded && (
        <div className="ml-4 border-l-2 border-muted pl-3 mt-1 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key}>
              <span className="text-xs font-semibold text-muted-foreground">{key}:</span>{" "}
              <JsonTree data={value} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Custom Data Editor
// ============================================================================

function CustomDataEditor({
  targetStage,
  onDataChange,
}: {
  targetStage: string;
  onDataChange: (data: { masterEnrichment?: any; narrative?: string } | null) => void;
}) {
  const [masterEnrichmentJson, setMasterEnrichmentJson] = useState("");
  const [narrativeText, setNarrativeText] = useState("");

  useEffect(() => {
    setMasterEnrichmentJson("");
    setNarrativeText("");
    onDataChange(null);
  }, [targetStage, onDataChange]);

  const handleMasterEnrichmentChange = (value: string) => {
    setMasterEnrichmentJson(value);
    try {
      const parsed = JSON.parse(value);
      onDataChange({
        masterEnrichment: parsed,
        narrative: narrativeText || undefined,
      });
    } catch (err) {
      if (value.trim() === "") {
        onDataChange({
          narrative: narrativeText || undefined,
        });
      }
    }
  };

  const handleNarrativeChange = (value: string) => {
    setNarrativeText(value);
    try {
      const master = masterEnrichmentJson ? JSON.parse(masterEnrichmentJson) : undefined;
      onDataChange({
        masterEnrichment: master,
        narrative: value || undefined,
      });
    } catch (err) {
      onDataChange({
        narrative: value || undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      {["narrative", "image", "actions"].includes(targetStage) && (
        <div>
          <Label htmlFor="master-enrichment" className="text-sm font-medium">
            Master Enrichment (JSON)
          </Label>
          <Textarea
            id="master-enrichment"
            className="mt-2 h-48 font-mono text-xs"
            value={masterEnrichmentJson}
            onChange={(e) => handleMasterEnrichmentChange(e.target.value)}
            placeholder='{"enrichment": {...}, "flattened": {...}}'
          />
        </div>
      )}

      {["image", "actions"].includes(targetStage) && (
        <div>
          <Label htmlFor="narrative-text" className="text-sm font-medium">
            Narrative Text
          </Label>
          <Textarea
            id="narrative-text"
            className="mt-2 h-32 text-sm"
            value={narrativeText}
            onChange={(e) => handleNarrativeChange(e.target.value)}
            placeholder="As you approach the console, alien symbols dance across the cracked screen..."
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function StatusBadge({ status, compact }: { status: PceTestRun["status"]; compact?: boolean }) {
  const config = {
    success: { icon: CheckCircle2, className: "text-green-600 border-green-600" },
    partial_success: { icon: AlertCircle, className: "text-amber-600 border-amber-600" },
    failure: { icon: XCircle, className: "text-destructive border-destructive" },
  }[status];

  const Icon = config.icon;

  if (compact) {
    return <Icon className={cn("h-3.5 w-3.5", config.className)} />;
  }

  return (
    <Badge variant="outline" className={config.className}>
      <Icon className="h-3 w-3 mr-1" />
      {status.replace("_", " ")}
    </Badge>
  );
}

function parseStageResults(payload: unknown): InspectorStageResults | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload as InspectorStageResults;
}