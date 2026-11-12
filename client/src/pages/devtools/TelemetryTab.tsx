import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Clock, TrendingUp, Activity, Database, Zap, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";

interface MetricDataPoint {
  labels: Record<string, string>;
  value?: number;
  p50?: number;
  p95?: number;
  p99?: number;
  avg?: number;
}

interface MetricsData {
  [metricName: string]: MetricDataPoint[];
}

function getStats(data: MetricDataPoint[]): { min: number; max: number; avg: number; p50: number; p95: number; p99: number } {
  if (data.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  
  // If we have histogram data (p50, p95, p99), use that
  if (data[0].p50 !== undefined) {
    const values = data.map(d => d.p50 || 0);
    const p95Values = data.map(d => d.p95 || 0);
    const p99Values = data.map(d => d.p99 || 0);
    const avgValues = data.map(d => d.avg || 0);
    
    return {
      min: Math.min(...values),
      max: Math.max(...p99Values),
      avg: avgValues.reduce((sum, val) => sum + val, 0) / avgValues.length,
      p50: values.reduce((sum, val) => sum + val, 0) / values.length,
      p95: p95Values.reduce((sum, val) => sum + val, 0) / p95Values.length,
      p99: p99Values.reduce((sum, val) => sum + val, 0) / p99Values.length
    };
  }
  
  // Otherwise calculate from raw values
  const values = data.map(d => d.value || 0).filter(v => v > 0);
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  
  return { min, max, avg, p50, p95, p99 };
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function MetricCard({ title, metricName, metrics, icon: Icon }: { 
  title: string; 
  metricName: string; 
  metrics: MetricsData;
  icon: any;
}) {
  const data = metrics[metricName] || [];
  const stats = getStats(data);
  
  // Group by labels for display
  const groupedByLabels = data.reduce((acc, d) => {
    const labelKey = JSON.stringify(d.labels);
    if (!acc[labelKey]) {
      acc[labelKey] = [];
    }
    acc[labelKey].push(d);
    return acc;
  }, {} as Record<string, MetricDataPoint[]>);
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{metricName}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Average</div>
                <div className="text-lg font-semibold">{formatDuration(stats.avg)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">P95</div>
                <div className="text-lg font-semibold">{formatDuration(stats.p95)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">P50</div>
                <div className="text-sm">{formatDuration(stats.p50)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">P99</div>
                <div className="text-sm">{formatDuration(stats.p99)}</div>
              </div>
            </div>
            {Object.keys(groupedByLabels).length > 1 && (
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium">By Labels:</div>
                <ScrollArea className="h-48">
                  {Object.entries(groupedByLabels).map(([key, points]) => {
                    const labels = JSON.parse(key);
                    const pointStats = getStats(points);
                    return (
                      <div key={key} className="text-sm border-l-2 pl-2 mb-2">
                        <div className="flex gap-2 flex-wrap mb-1">
                          {Object.entries(labels).map(([k, v]) => (
                            <Badge key={k} variant="outline">{k}={String(v)}</Badge>
                          ))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Avg: {formatDuration(pointStats.avg)} | P50: {formatDuration(pointStats.p50)} | P95: {formatDuration(pointStats.p95)} | P99: {formatDuration(pointStats.p99)}
                        </div>
                      </div>
                    );
                  })}
                </ScrollArea>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No data available</div>
        )}
      </CardContent>
    </Card>
  );
}

export function TelemetryTab() {
  const { data: metrics, isLoading, refetch } = useQuery<MetricsData>({
    queryKey: ["/api/admin/telemetry/metrics"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">Loading metrics...</div>
        </CardContent>
      </Card>
    );
  }

  if (!metrics) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">Failed to load metrics</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Execution Time Telemetry</h2>
          <p className="text-muted-foreground">Monitor performance metrics and identify bottlenecks</p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="pce" className="w-full">
        <TabsList>
          <TabsTrigger value="pce">PCE Pipeline</TabsTrigger>
          <TabsTrigger value="workers">Workers</TabsTrigger>
          <TabsTrigger value="llm">LLM Calls</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="e2e">End-to-End</TabsTrigger>
        </TabsList>

        <TabsContent value="pce" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title="PCE Stage Duration"
              metricName="pce_stage_duration_ms"
              metrics={metrics}
              icon={Activity}
            />
            <MetricCard
              title="Variable Building"
              metricName="variable_build_duration_ms"
              metrics={metrics}
              icon={Zap}
            />
            <MetricCard
              title="Prompt Building"
              metricName="prompt_build_duration_ms"
              metrics={metrics}
              icon={Zap}
            />
            <MetricCard
              title="Template Loading"
              metricName="template_load_duration_ms"
              metrics={metrics}
              icon={Clock}
            />
          </div>
        </TabsContent>

        <TabsContent value="workers" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title="Turn Precompute Phases"
              metricName="turn_precompute_phase_duration_ms"
              metrics={metrics}
              icon={Activity}
            />
            <MetricCard
              title="Turn Apply Phases"
              metricName="turn_apply_phase_duration_ms"
              metrics={metrics}
              icon={Activity}
            />
            <MetricCard
              title="Image Processing"
              metricName="image_processing_duration_ms"
              metrics={metrics}
              icon={ImageIcon}
            />
          </div>
        </TabsContent>

        <TabsContent value="llm" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title="LLM Call Duration"
              metricName="llm_call_duration_ms"
              metrics={metrics}
              icon={Zap}
            />
            <MetricCard
              title="Image Model Call Duration"
              metricName="image_model_call_duration_ms"
              metrics={metrics}
              icon={ImageIcon}
            />
          </div>
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <MetricCard
            title="Database Operations"
            metricName="db_operation_duration_ms"
            metrics={metrics}
            icon={Database}
          />
        </TabsContent>

        <TabsContent value="e2e" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title="End-to-End Latency"
              metricName="e2e_latency_ms"
              metrics={metrics}
              icon={TrendingUp}
            />
            <MetricCard
              title="Queue Wait Time"
              metricName="queue_latency_histogram"
              metrics={metrics}
              icon={Clock}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

