import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCw, Trash2, Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

import { LlmLog } from "./types";

export function LogsTab() {
  const { data: logs, isLoading: logsLoading } = useQuery<LlmLog[]>({
    queryKey: ["/api/llm-logs"],
  });
  const { toast } = useToast();

  const [logFilter, setLogFilter] = useState("");
  const [copiedItems, setCopiedItems] = useState<Set<string>>(() => new Set());

  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", "/api/llm-logs");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm-logs"] });
      toast({
        title: "Logs Cleared",
        description: "All LLM logs have been deleted successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Clear Failed",
        description: "Failed to clear the logs.",
        variant: "destructive",
      });
    },
  });

  const filteredLogs = useMemo(() => {
    if (!logs) {
      return [];
    }

    const filterValue = logFilter.toLowerCase();
    if (!filterValue) {
      return logs;
    }

    return logs.filter(
      (log) =>
        log.functionName.toLowerCase().includes(filterValue) ||
        String(log.metadata?.model ?? "").toLowerCase().includes(filterValue) ||
        log.prompt.toLowerCase().includes(filterValue) ||
        log.response.toLowerCase().includes(filterValue),
    );
  }, [logFilter, logs]);

  const handleCopy = async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItems((previous) => new Set(previous).add(itemId));
      toast({
        title: "Copied to clipboard",
        description: "The content has been copied successfully.",
      });

      setTimeout(() => {
        setCopiedItems((previous) => {
          const next = new Set(previous);
          next.delete(itemId);
          return next;
        });
      }, 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM Interaction Logs</CardTitle>
        <CardDescription>View all prompts sent to GPT-4o-mini and their responses</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Filter logs by function, model, prompt, or response..."
              value={logFilter}
              onChange={(event) => setLogFilter(event.target.value)}
              data-testid="input-log-filter"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/llm-logs"] })}
              data-testid="button-refresh-logs"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" data-testid="button-clear-logs">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Logs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all LLM logs from the database. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearLogsMutation.mutate()} data-testid="button-confirm-clear">
                    Clear All Logs
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <ScrollArea className="h-[700px]">
            {logsLoading ? (
              <p className="text-muted-foreground">Loading logs...</p>
            ) : (
              <div className="space-y-4">
                {filteredLogs.map((log) => (
                  <Card key={log.id} data-testid={`log-${log.id}`}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" data-testid={`badge-function-${log.functionName}`}>
                            {log.functionName}
                          </Badge>
                          {log.metadata?.model && (
                            <Badge variant="secondary" className="font-mono" title="Model that answered this call">
                              {String(log.metadata.model)}
                            </Badge>
                          )}
                          {log.metadata?.error && <Badge variant="destructive">Error</Badge>}
                          {log.executionTimeMs && <Badge variant="secondary">{log.executionTimeMs}ms</Badge>}
                          {log.turnNumber !== null && <Badge>Turn {log.turnNumber}</Badge>}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs font-semibold">Prompt</Label>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(log.prompt, `${log.id}-prompt`)}
                            data-testid={`button-copy-prompt-${log.id}`}
                            className="h-6 w-6"
                          >
                            {copiedItems.has(`${log.id}-prompt`) ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="mt-1 p-3 bg-muted rounded-md text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto">
                          {log.prompt}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs font-semibold">Response</Label>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(log.response, `${log.id}-response`)}
                            data-testid={`button-copy-response-${log.id}`}
                            className="h-6 w-6"
                          >
                            {copiedItems.has(`${log.id}-response`) ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="mt-1 p-3 bg-muted rounded-md text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto">
                          {log.response}
                        </div>
                      </div>
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <div>
                          <Label className="text-xs font-semibold">Metadata</Label>
                          <div className="mt-1 p-3 bg-muted rounded-md text-xs font-mono">
                            {JSON.stringify(log.metadata, null, 2)}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {filteredLogs.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">No logs found matching your filter</div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
