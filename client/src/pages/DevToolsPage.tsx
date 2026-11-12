import { type FormEvent, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { getAdminAuthToken, setAdminAuthToken, subscribeToAdminAuthTokenChanges, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CacheTab } from "@/pages/devtools/CacheTab";
import { EventsTab } from "@/pages/devtools/EventsTab";
import { ImagePromptsTab } from "@/pages/devtools/ImagePromptsTab";
import { InterviewTab } from "@/pages/devtools/InterviewTab";
import { ItemsTab } from "@/pages/devtools/ItemsTab";
import { LogsTab } from "@/pages/devtools/LogsTab";
import { NpcsTab } from "@/pages/devtools/NpcsTab";
import { PromptsTab } from "@/pages/devtools/PromptsTab";
import { ReferenceTab } from "@/pages/devtools/ReferenceTab";
import { PceTab } from "@/pages/devtools/PceTab";
import { PCEInspectorTab } from "@/pages/devtools/PCEInspectorTab";
import { SettingsTab } from "@/pages/devtools/SettingsTab";
import { TelemetryTab } from "@/pages/devtools/TelemetryTab";
import { GameTelemetryTab } from "@/pages/devtools/GameTelemetryTab";
import DevToolsImageModels from "@/components/DevToolsImageModels";
import { LlmModelsTab } from "@/pages/devtools/LlmModelsTab";
import { EvalsTab } from "@/pages/devtools/EvalsTab";

export default function DevToolsPage() {
  const [adminToken, setAdminTokenState] = useState<string | null>(() => getAdminAuthToken());
  const [tokenInput, setTokenInput] = useState(() => getAdminAuthToken() ?? "");
  const [authError, setAuthError] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToAdminAuthTokenChanges(() => {
      const nextToken = getAdminAuthToken();
      setAdminTokenState(nextToken);
      setTokenInput(nextToken ?? "");
    });
  }, []);

  useEffect(() => {
    async function fetchLastMode() {
      try {
        // Last LLM mode
        const logsRes = await apiRequest('GET', '/api/llm-logs?limit=1');
        const logs = await logsRes.json();
        const mode = logs?.[0]?.metadata?.mode ?? null;
        setLastMode(mode);
      } catch (e) {
        // Non-fatal: leave hints empty
      }
    }
    if (adminToken) {
      fetchLastMode();
    }
  }, [adminToken]);

  const handleTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = tokenInput.trim();

    if (!normalized) {
      setAuthError("Token is required");
      return;
    }

    setAdminAuthToken(normalized);
    setAuthError(null);
    setAdminTokenState(normalized);
  };

  const handleTokenClear = () => {
    setAdminAuthToken(null);
    setAdminTokenState(null);
    setAuthError(null);
  };

  if (!adminToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin Access Required</CardTitle>
            <CardDescription>Enter the administrator access token to manage content.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleTokenSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="admin-token">Access Token</Label>
                <Input
                  id="admin-token"
                  type="password"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="Enter admin token"
                />
              </div>
              {authError && <p className="text-sm text-destructive">{authError}</p>}
              <div className="flex items-center justify-between gap-2">
                <Button type="submit" className="flex-1">
                  Unlock Developer Tools
                </Button>
                <Button type="button" variant="outline" onClick={handleTokenClear}>
                  Clear
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Developer Tools</h1>
              <p className="text-muted-foreground">Manage prompts, events, and analyze LLM interactions</p>
            </div>
          {adminToken && (
            <div className="text-xs text-muted-foreground text-right">
              <div><span className="font-medium">Last LLM mode:</span> {lastMode ?? '—'}</div>
            </div>
          )}
          </div>
          <Button variant="outline" onClick={handleTokenClear}>
            Log out
          </Button>
        </div>

        <Tabs defaultValue="prompts" className="w-full">
          <TabsList className="w-full max-w-6xl" data-testid="tabs-devtools">
            <TabsTrigger value="prompts" data-testid="tab-prompts">
              Prompts
            </TabsTrigger>
            <TabsTrigger value="events" data-testid="tab-events">
              Events
            </TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items">
              Items
            </TabsTrigger>
            <TabsTrigger value="npcs" data-testid="tab-npcs">
              NPCs
            </TabsTrigger>
            <TabsTrigger value="image-prompts" data-testid="tab-image-prompts">
              Image Prompts
            </TabsTrigger>
            <TabsTrigger value="image-models" data-testid="tab-image-models">
              Image Models
            </TabsTrigger>
            <TabsTrigger value="llm-models" data-testid="tab-llm-models">
              LLM Models
            </TabsTrigger>
            <TabsTrigger value="pce" data-testid="tab-pce">
              PCE
            </TabsTrigger>
            <TabsTrigger value="pce-inspector" data-testid="tab-pce-inspector">
              PCE Inspector
            </TabsTrigger>
            <TabsTrigger value="evals" data-testid="tab-evals">
              Evals
            </TabsTrigger>
            <TabsTrigger value="interview" data-testid="tab-interview">
              Interview
            </TabsTrigger>
            <TabsTrigger value="reference" data-testid="tab-reference">
              Reference
            </TabsTrigger>
            <TabsTrigger value="logs" data-testid="tab-logs">
              LLM Logs
            </TabsTrigger>
            <TabsTrigger value="cache" data-testid="tab-cache">
              Image Cache
            </TabsTrigger>
            <TabsTrigger value="telemetry" data-testid="tab-telemetry">
              Telemetry
            </TabsTrigger>
            <TabsTrigger value="game-telemetry" data-testid="tab-game-telemetry">
              Game Telemetry
            </TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="prompts" className="space-y-4">
            <PromptsTab />
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            <EventsTab />
          </TabsContent>

          <TabsContent value="items" className="space-y-4">
            <ItemsTab />
          </TabsContent>

          <TabsContent value="npcs" className="space-y-4">
            <NpcsTab />
          </TabsContent>

          <TabsContent value="image-prompts" className="space-y-4">
            <ImagePromptsTab />
          </TabsContent>

          <TabsContent value="image-models" className="space-y-4">
            <DevToolsImageModels />
          </TabsContent>

          <TabsContent value="llm-models" className="space-y-4">
            <LlmModelsTab />
          </TabsContent>

          <TabsContent value="pce" className="space-y-4">
            <PceTab />
          </TabsContent>

          <TabsContent value="pce-inspector" className="space-y-4">
            <PCEInspectorTab />
          </TabsContent>

          <TabsContent value="evals" className="space-y-4">
            <EvalsTab />
          </TabsContent>

          <TabsContent value="interview" className="space-y-4">
            <InterviewTab />
          </TabsContent>

          <TabsContent value="reference" className="space-y-4">
            <ReferenceTab />
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <LogsTab />
          </TabsContent>

          <TabsContent value="cache" className="space-y-4">
            <CacheTab />
          </TabsContent>

          <TabsContent value="telemetry" className="space-y-4">
            <TelemetryTab />
          </TabsContent>

          <TabsContent value="game-telemetry" className="space-y-4">
            <GameTelemetryTab />
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
