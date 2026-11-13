import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Upload, CheckCircle, Clock, User } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ReferenceRelease {
  version: string;
  published_by: string;
  notes: string | null;
  published_at: string;
  is_current: number;
  /** False when the release's folder is missing on this server, so it cannot be activated here. */
  filesOnDisk?: boolean;
  /** 1 = active rows only; 2 = also every content row, enough to load an empty database. */
  formatVersion?: number | null;
  /** Rows per content table stored in the release (format 2). */
  workspaceRows?: Record<string, number> | null;
}

/** What a release holds, shown under its name. */
function ReleaseContents({ release }: { release: ReferenceRelease }) {
  if (release.filesOnDisk === false) {
    return (
      <p className="text-xs text-amber-600" data-testid={`release-contents-${release.version}`}>
        Files are not on this server; this release cannot be activated here.
      </p>
    );
  }
  if (release.formatVersion === 2 && release.workspaceRows) {
    const tables = Object.entries(release.workspaceRows);
    const total = tables.reduce((sum, [, rows]) => sum + rows, 0);
    return (
      <p
        className="text-xs text-muted-foreground"
        title={tables.map(([table, rows]) => `${table}: ${rows}`).join("\n")}
        data-testid={`release-contents-${release.version}`}
      >
        Complete release: {total} rows in {tables.length} tables, including inactive ones. Can load an empty database.
      </p>
    );
  }
  if (release.formatVersion === 1) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`release-contents-${release.version}`}>
        Older format: active rows only, without interview questions or Inspector scenarios.
      </p>
    );
  }
  return null;
}

/** Result of comparing the database with its current release (GET /api/admin/reference/verify). */
interface VerifyResult {
  ok: boolean;
  version: string | null;
  checks: { name: string; ok: boolean; expected: number; actual: number; differences: string[] }[];
  problems: string[];
}

/** The outcome of a Verify run: one line when everything matches, otherwise what differs. */
function VerifyOutcome({ result }: { result: VerifyResult }) {
  if (result.ok) {
    return (
      <p className="text-sm text-green-600" data-testid="verify-result">
        The database matches release {result.version}: {result.checks.length} checks passed.
        Unpublished edits made in Dev Tools would show up here as differences.
      </p>
    );
  }
  const failed = result.checks.filter((check) => !check.ok);
  return (
    <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-2" data-testid="verify-result">
      <p className="font-medium">
        The database differs from release {result.version ?? "(none)"}. If you edited content in Dev Tools
        since publishing, this is expected: publish a new release to capture it.
      </p>
      {result.problems.length > 0 && (
        <ul className="list-disc pl-5">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {failed.map((check) => (
        <div key={check.name}>
          <p className="font-medium">
            {check.name}: {check.actual} in the database, {check.expected} in the release
          </p>
          <ul className="list-disc pl-5 break-words">
            {check.differences.map((difference) => (
              <li key={difference}>{difference}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function DevToolsReferencePublisher() {
  const [newVersion, setNewVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [author, setAuthor] = useState("dev");
  const [publishWarnings, setPublishWarnings] = useState<string[]>([]);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Compare the database with the current release
  const verifyMutation = useMutation({
    mutationFn: async (): Promise<VerifyResult> => {
      const response = await apiRequest("GET", "/api/admin/reference/verify");
      if (!response.ok) throw new Error("Failed to verify the database against the release");
      return response.json();
    },
    onSuccess: (result) => setVerifyResult(result),
    onError: (error) => {
      toast({ title: "Verify Failed", description: error.message, variant: "destructive" });
    },
  });

  // Fetch current reference
  const { data: currentReference, isLoading: isLoadingCurrent } = useQuery({
    queryKey: ["current-reference"],
    queryFn: async (): Promise<ReferenceRelease | undefined> => {
      const response = await apiRequest("GET", "/api/admin/reference/current");
      if (!response.ok) throw new Error("Failed to fetch current reference");
      const data = await response.json();
      return data.current;
    },
  });

  // Fetch all releases
  const { data: releases, isLoading: isLoadingReleases } = useQuery({
    queryKey: ["reference-releases"],
    queryFn: async (): Promise<ReferenceRelease[]> => {
      const response = await apiRequest("GET", "/api/admin/reference/releases");
      if (!response.ok) throw new Error("Failed to fetch releases");
      const data = await response.json();
      return data.releases;
    },
  });

  // Publish new reference mutation
  const publishMutation = useMutation({
    mutationFn: async ({ version, author, notes, makeCurrent }: {
      version: string;
      author: string;
      notes: string;
      makeCurrent: boolean;
    }) => {
      const response = await apiRequest("POST", `/api/admin/reference/publish/${version}`, {
        author,
        notes,
        makeCurrent,
      });
      if (!response.ok) throw new Error("Failed to publish reference");
      return response.json();
    },
    onSuccess: (result: { warnings?: string[] }) => {
      toast({
        title: "Reference Published",
        description: `Successfully published reference ${newVersion}`,
      });
      // Problems that did not block the publish but are worth fixing (e.g. story model checks).
      setPublishWarnings(result?.warnings ?? []);
      setVerifyResult(null);
      setNewVersion("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["reference-releases"] });
      queryClient.invalidateQueries({ queryKey: ["current-reference"] });
      // Invalidate all reference data queries so dropdowns refresh with new data
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'story-themes'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'visual-styles'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'image-models'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'llm-models'] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/llm-models"] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'system-defaults'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'settings'] });
    },
    onError: (error) => {
      toast({
        title: "Publish Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Activate reference mutation
  const activateMutation = useMutation({
    mutationFn: async (version: string) => {
      const response = await apiRequest("POST", `/api/admin/reference/${version}/activate`);
      if (!response.ok) throw new Error("Failed to activate reference");
      return response.json();
    },
    onSuccess: (_, version) => {
      toast({
        title: "Reference Activated",
        description: `Successfully activated reference ${version}`,
      });
      queryClient.invalidateQueries({ queryKey: ["reference-releases"] });
      queryClient.invalidateQueries({ queryKey: ["current-reference"] });
      // Invalidate all reference data queries so dropdowns refresh with new data
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'story-themes'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'visual-styles'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'image-models'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'llm-models'] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/llm-models"] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'system-defaults'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'reference', 'settings'] });
    },
    onError: (error) => {
      toast({
        title: "Activation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePublish = () => {
    if (!newVersion.trim()) {
      toast({
        title: "Version Required",
        description: "Please enter a version name",
        variant: "destructive",
      });
      return;
    }

    publishMutation.mutate({
      version: newVersion.trim(),
      author: author.trim() || "dev",
      notes: notes.trim() || "",
      makeCurrent: true,
    });
  };

  const handleActivate = (version: string) => {
    activateMutation.mutate(version);
  };

  if (isLoadingCurrent || isLoadingReleases) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reference Publisher</CardTitle>
          <CardDescription>Loading reference data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Current Active Reference
          </CardTitle>
          <CardDescription>
            This is the reference version currently being used by all games
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentReference ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-sm">
                  {currentReference.version}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Published by {currentReference.published_by}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {new Date(currentReference.published_at).toLocaleString()}
              </div>
              {currentReference.notes && (
                <p className="text-sm text-muted-foreground">
                  {currentReference.notes}
                </p>
              )}
              <ReleaseContents release={currentReference} />
              <div className="pt-2 space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                  data-testid="verify-release"
                >
                  {verifyMutation.isPending ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  Verify database against this release
                </Button>
                {verifyResult && <VerifyOutcome result={verifyResult} />}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No current reference set
            </p>
          )}
        </CardContent>
      </Card>

      {/* Publish New Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Publish New Reference
          </CardTitle>
          <CardDescription>
            Create a new reference release from the current database state. The release holds
            what the game loads (active rows) and a full copy of every content table, so an
            empty database can be set up from it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {publishWarnings.length > 0 && (
            <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-1" data-testid="publish-warnings">
              <p className="font-medium">Published, with {publishWarnings.length === 1 ? "a warning" : "warnings"}:</p>
              <ul className="list-disc pl-5">
                {publishWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                placeholder="e.g., v1.2.0"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author">Author</Label>
              <Input
                id="author"
                placeholder="Your name"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Describe what changed in this release..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <Button
            onClick={handlePublish}
            disabled={publishMutation.isPending || !newVersion.trim()}
            className="w-full"
          >
            {publishMutation.isPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Publish & Activate
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* All Releases */}
      <Card>
        <CardHeader>
          <CardTitle>All Reference Releases</CardTitle>
          <CardDescription>
            Manage and activate previous reference releases
          </CardDescription>
        </CardHeader>
        <CardContent>
          {releases && releases.length > 0 ? (
            <div className="space-y-3">
              {releases.map((release) => (
                <div
                  key={release.version}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={release.is_current ? "default" : "secondary"}
                      >
                        {release.version}
                      </Badge>
                      {release.is_current && (
                        <Badge variant="outline" className="text-green-600">
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {release.published_by}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(release.published_at).toLocaleString()}
                      </div>
                    </div>
                    {release.notes && (
                      <p className="text-sm text-muted-foreground">
                        {release.notes}
                      </p>
                    )}
                    <ReleaseContents release={release} />
                  </div>
                  {!release.is_current && release.filesOnDisk !== false && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleActivate(release.version)}
                      disabled={activateMutation.isPending}
                    >
                      {activateMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        "Activate"
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reference releases found
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
