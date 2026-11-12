import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";

import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import { PromptTemplate } from "./types";
import { PceVariableReference } from "./components/PceVariableReference";
import type { PceStage } from "./pceVariables";

export function PromptsTab() {
  const { data: prompts, isLoading: promptsLoading } = useQuery<PromptTemplate[]>({
    queryKey: ["/api/admin/prompt_templates"],
  });
  const { toast } = useToast();

  const [selectedPrompt, setSelectedPrompt] = useState<PromptTemplate | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [editedSystemContent, setEditedSystemContent] = useState<string | null>(null);
  const [inheritGlobalPrompt, setInheritGlobalPrompt] = useState(1);

  const updatePromptMutation = useMutation({
    mutationFn: async ({
      id,
      content,
      systemContent,
      inheritGlobalPrompt: inherit,
    }: {
      id: string;
      content: string;
      systemContent: string | null;
      inheritGlobalPrompt: number;
    }) => {
      return await apiRequest("PUT", `/api/admin/prompt_templates/${id}`, {
        content,
        systemContent,
        inheritGlobalPrompt: inherit,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/prompt_templates"] });
      toast({
        title: "Prompt Updated",
        description: "The prompt template has been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update the prompt template.",
        variant: "destructive",
      });
    },
  });

  const handleSelectPrompt = (prompt: PromptTemplate) => {
    setSelectedPrompt(prompt);
    setEditedContent(prompt.content);
    setEditedSystemContent(prompt.systemContent || null);
    setInheritGlobalPrompt(prompt.inheritGlobalPrompt);
  };

  const handleSavePrompt = () => {
    if (!selectedPrompt) {
      return;
    }

    updatePromptMutation.mutate({
      id: selectedPrompt.id,
      content: editedContent,
      systemContent: editedSystemContent,
      inheritGlobalPrompt,
    });
  };

  // Detect PCE prompts and extract stage
  const isPcePrompt = selectedPrompt?.name.startsWith("pce_");
  const pceStage: PceStage | null = isPcePrompt && selectedPrompt
    ? (selectedPrompt.name.replace("pce_", "") as PceStage)
    : null;

  // Use 3-column layout for PCE prompts, 2-column for others
  const gridCols = isPcePrompt ? "md:grid-cols-3" : "md:grid-cols-2";

  return (
    <div className={`grid ${gridCols} gap-6`}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Prompt Templates</CardTitle>
              <CardDescription>Select a prompt template to edit</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {promptsLoading ? (
              <p className="text-muted-foreground">Loading prompts...</p>
            ) : (
              <div className="space-y-2">
                {prompts
                  ?.filter((prompt) => prompt.name !== "visual_style_prompt")
                  .map((prompt) => (
                    <Button
                      key={prompt.id}
                      variant={selectedPrompt?.id === prompt.id ? "secondary" : "ghost"}
                      className="w-full justify-start"
                      onClick={() => handleSelectPrompt(prompt)}
                      data-testid={`button-prompt-${prompt.name}`}
                    >
                      <div className="flex flex-col items-start w-full">
                        <div className="font-semibold">{prompt.name}</div>
                        <div className="text-xs text-muted-foreground">
                          v{prompt.version} • {prompt.active ? "Active" : "Inactive"}
                        </div>
                        {prompt.description && (
                          <div className="text-xs text-muted-foreground mt-1">{prompt.description}</div>
                        )}
                      </div>
                    </Button>
                  ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {isPcePrompt && (
        <Card>
          <CardHeader>
            <CardTitle>Variable Reference</CardTitle>
            <CardDescription>
              PCE variables available for this stage. Click to copy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PceVariableReference stage={pceStage} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{selectedPrompt ? `Edit: ${selectedPrompt.name}` : "Select a prompt"}</CardTitle>
          <CardDescription>
            {selectedPrompt
              ? "Edit the prompt content. Use {{VARIABLE}} for placeholders."
              : "Choose a prompt from the list to edit"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedPrompt ? (
            <div className="space-y-4">
              {selectedPrompt.name === "visual_style_prompt" ? (
                <div className="space-y-2">
                  <Label htmlFor="visual-style-content">Visual Style Prompt</Label>
                  <p className="text-xs text-muted-foreground">
                    This shared visual style will be prepended to all image generation prompts that have
                    &quot;Inherit Visual Style&quot; enabled
                  </p>
                  <Textarea
                    id="visual-style-content"
                    value={editedContent}
                    onChange={(event) => setEditedContent(event.target.value)}
                    placeholder="Enter the shared visual style description for all image generation..."
                    className="h-[500px] font-mono text-sm"
                    data-testid="textarea-visual-style"
                  />
                </div>
              ) : (
                <>
                  {selectedPrompt.name !== "global_system_prompt" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="system-prompt-content">System Prompt</Label>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="inherit-global"
                            checked={inheritGlobalPrompt === 1}
                            onCheckedChange={(checked) => setInheritGlobalPrompt(checked ? 1 : 0)}
                            data-testid="checkbox-inherit-global"
                          />
                          <Label htmlFor="inherit-global" className="text-sm font-normal cursor-pointer">
                            Inherit Global System Prompt
                          </Label>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {inheritGlobalPrompt === 1
                          ? "Will extend the global system prompt with your additions below"
                          : "Will use only the custom system prompt below (complete override)"}
                      </p>
                      <Textarea
                        id="system-prompt-content"
                        value={editedSystemContent || ""}
                        onChange={(event) => setEditedSystemContent(event.target.value || null)}
                        placeholder={
                          inheritGlobalPrompt === 1
                            ? "Add scenario-specific instructions to extend the global prompt..."
                            : "Enter complete system prompt (replaces global)..."
                        }
                        className="h-[200px] font-mono text-sm"
                        data-testid="textarea-system-prompt"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="user-prompt-content">User Prompt</Label>
                    <Textarea
                      id="user-prompt-content"
                      value={editedContent}
                      onChange={(event) => setEditedContent(event.target.value)}
                      className="h-[300px] font-mono text-sm"
                      data-testid="textarea-user-prompt"
                    />
                  </div>
                </>
              )}
              <Button
                onClick={handleSavePrompt}
                disabled={updatePromptMutation.isPending}
                className="w-full"
                data-testid="button-save-prompt"
              >
                <Save className="h-4 w-4 mr-2" />
                {updatePromptMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          ) : (
            <div className="h-[500px] flex items-center justify-center text-muted-foreground">
              Select a prompt template to begin editing
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
