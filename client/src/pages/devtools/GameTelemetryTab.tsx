import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface TurnTiming {
  turnNumber: number;
  createdAt: string;
  totalDurationMs: number;
  queueWaitMs: number;
  precomputeMs: number;
  applyMs: number;
  llmCalls: Array<{
    model: string;
    template: string;
    latencyMs: number;
    cache: string;
  }>;
}

interface GameTelemetryData {
  gameId: string;
  username: string;
  turnNumber: number;
  totalTurns: number;
  turns: TurnTiming[];
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function WaterfallBar({ label, width, color, tooltip }: { label: string; width: number; color: string; tooltip?: string }) {
  const percentage = Math.min(100, Math.max(0, width));
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="w-32 text-xs text-muted-foreground truncate">{label}</div>
      <div className="flex-1 relative">
        <div
          className="h-6 rounded flex items-center justify-end pr-2 text-xs font-medium text-white"
          style={{ width: `${percentage}%`, backgroundColor: color, minWidth: percentage > 0 ? '2px' : '0' }}
          title={tooltip}
        >
          {percentage > 5 && formatDuration(width)}
        </div>
      </div>
    </div>
  );
}

function TurnTimingVisualization({ turn }: { turn: TurnTiming }) {
  const maxDuration = Math.max(turn.totalDurationMs, turn.queueWaitMs + turn.precomputeMs + turn.applyMs);
  const scale = maxDuration > 0 ? 100 / maxDuration : 0;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Turn {turn.turnNumber}</CardTitle>
        <CardDescription className="text-xs">
          Total: {formatDuration(turn.totalDurationMs)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <WaterfallBar
            label="Queue Wait"
            width={turn.queueWaitMs * scale}
            color="#ef4444"
            tooltip={`Queue wait: ${formatDuration(turn.queueWaitMs)}`}
          />
          <WaterfallBar
            label="Precompute"
            width={turn.precomputeMs * scale}
            color="#3b82f6"
            tooltip={`Precompute: ${formatDuration(turn.precomputeMs)}`}
          />
          <WaterfallBar
            label="Apply"
            width={turn.applyMs * scale}
            color="#10b981"
            tooltip={`Apply: ${formatDuration(turn.applyMs)}`}
          />
          
          {turn.llmCalls.length > 0 && (
            <div className="mt-4 pt-2 border-t">
              <div className="text-xs font-medium text-muted-foreground mb-2">LLM Calls:</div>
              {turn.llmCalls.map((call, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs mb-1">
                  <Badge variant="outline" className="text-xs">
                    {call.template}
                  </Badge>
                  <span className="text-muted-foreground">{formatDuration(call.latencyMs)}</span>
                  <Badge variant={call.cache === 'hit' ? 'default' : 'secondary'} className="text-xs">
                    {call.cache}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function GameTelemetryTab() {
  const [gameId, setGameId] = useState("");
  const [searchGameId, setSearchGameId] = useState<string | null>(null);

  const { data: telemetry, isLoading, error } = useQuery<GameTelemetryData>({
    queryKey: ["/api/admin/telemetry/game", searchGameId],
    queryFn: async () => {
      if (!searchGameId) throw new Error("No game ID provided");
      const response = await apiRequest("GET", `/api/admin/telemetry/game/${searchGameId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to load game telemetry");
      }
      return response.json();
    },
    enabled: !!searchGameId,
  });

  const handleSearch = () => {
    if (gameId.trim()) {
      setSearchGameId(gameId.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // Calculate summary statistics
  const summary = telemetry?.turns.length
    ? {
        avgTotal: telemetry.turns.reduce((sum, t) => sum + t.totalDurationMs, 0) / telemetry.turns.length,
        avgQueueWait: telemetry.turns.reduce((sum, t) => sum + t.queueWaitMs, 0) / telemetry.turns.length,
        avgPrecompute: telemetry.turns.reduce((sum, t) => sum + t.precomputeMs, 0) / telemetry.turns.length,
        avgApply: telemetry.turns.reduce((sum, t) => sum + t.applyMs, 0) / telemetry.turns.length,
        totalLLMCalls: telemetry.turns.reduce((sum, t) => sum + t.llmCalls.length, 0),
        cacheHits: telemetry.turns.reduce((sum, t) => sum + t.llmCalls.filter(c => c.cache === 'hit').length, 0),
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Game Telemetry</h2>
          <p className="text-muted-foreground">View detailed timing breakdown for a specific game</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Game</CardTitle>
          <CardDescription>Enter a game ID to view telemetry data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="gameId" className="sr-only">Game ID</Label>
              <Input
                id="gameId"
                placeholder="Enter game ID (UUID)"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                onKeyPress={handleKeyPress}
              />
            </div>
            <Button onClick={handleSearch} disabled={!gameId.trim() || isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center text-destructive">
              {error instanceof Error ? error.message : "Failed to load game telemetry"}
            </div>
          </CardContent>
        </Card>
      )}

      {telemetry && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Summary - {telemetry.username}
              </CardTitle>
              <CardDescription>
                Game: {telemetry.gameId.slice(0, 8)}... | Current Turn: {telemetry.turnNumber} | Total Turns Analyzed: {telemetry.totalTurns}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Total Duration</div>
                    <div className="text-lg font-semibold">{formatDuration(summary.avgTotal)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Queue Wait</div>
                    <div className="text-lg font-semibold">{formatDuration(summary.avgQueueWait)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Precompute</div>
                    <div className="text-lg font-semibold">{formatDuration(summary.avgPrecompute)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Apply</div>
                    <div className="text-lg font-semibold">{formatDuration(summary.avgApply)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total LLM Calls</div>
                    <div className="text-lg font-semibold">{summary.totalLLMCalls}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Cache Hit Rate</div>
                    <div className="text-lg font-semibold">
                      {summary.totalLLMCalls > 0
                        ? `${((summary.cacheHits / summary.totalLLMCalls) * 100).toFixed(1)}%`
                        : "N/A"}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div>
            <h3 className="text-lg font-semibold mb-4">Turn-by-Turn Breakdown</h3>
            <ScrollArea className="h-[600px]">
              <div className="space-y-4">
                {telemetry.turns.map((turn) => (
                  <TurnTimingVisualization key={turn.turnNumber} turn={turn} />
                ))}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}

