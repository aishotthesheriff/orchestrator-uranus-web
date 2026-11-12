import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

/** IDs the server stores with a record so it can be found in LangSmith. */
export interface TraceRef {
  runId: string;
  traceId: string;
}

export function isTraceRef(value: unknown): value is TraceRef {
  const v = value as TraceRef | null | undefined;
  return !!v && typeof v.runId === "string" && typeof v.traceId === "string";
}

interface Props {
  /** Absent when the record was made with tracing off; nothing is rendered then. */
  trace?: TraceRef | null;
  label?: string;
}

/**
 * Opens a record's trace in LangSmith. The link is resolved on click (it needs a server
 * round trip), so a row of these costs nothing until one is used.
 */
export function TraceLink({ trace, label = "Open trace" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isTraceRef(trace)) return null;

  const open = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy(true);
    setError(null);
    // Opened before the request so the browser treats it as a response to the click.
    const tab = window.open("", "_blank");
    try {
      const params = new URLSearchParams({ runId: trace.runId, traceId: trace.traceId });
      const res = await apiRequest("GET", `/api/admin/observability/trace-url?${params}`);
      const { url } = (await res.json()) as { url: string };
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (err) {
      tab?.close();
      const raw = String((err as Error)?.message ?? err);
      setError(/409/.test(raw) ? "Tracing is off" : /404/.test(raw) ? "Trace not found (it may have expired)" : "Could not open trace");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={open} disabled={busy} data-testid="button-open-trace">
        {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ExternalLink className="h-3 w-3 mr-1" />}
        {label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
