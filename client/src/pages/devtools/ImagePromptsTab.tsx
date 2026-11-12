import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Save, Sparkles } from "lucide-react";

import { ImageTestModal } from "@/components/ImageTestModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

import { ImagePrompt, PromptTemplate } from "./types";

const defaultImagePromptForm = {
  name: "",
  promptTemplate: "",
  inheritVisualStyle: 1,
  size: "1024x1024",
  quality: "auto",
  description: "",
  sceneTypes: "",
  tags: "",
  active: 1,
};

export function ImagePromptsTab() {
  const { toast } = useToast();
  const { data: prompts } = useQuery<PromptTemplate[]>({
    queryKey: ["/api/admin/prompt_templates"],
  });
  const { data: imagePrompts, isLoading: imagePromptsLoading } = useQuery<ImagePrompt[]>({
    queryKey: ["/api/admin/image_prompts"],
  });

  const [visualStyleContent, setVisualStyleContent] = useState("");
  const [selectedImagePrompt, setSelectedImagePrompt] = useState<ImagePrompt | null>(null);
  const [isCreatingImagePrompt, setIsCreatingImagePrompt] = useState(false);
  const [imagePromptForm, setImagePromptForm] = useState({ ...defaultImagePromptForm });
  const [testImagePrompt, setTestImagePrompt] = useState<ImagePrompt | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);

  useEffect(() => {
    const visualStylePrompt = prompts?.find((prompt) => prompt.name === "visual_style_prompt");
    if (visualStylePrompt) {
      setVisualStyleContent(visualStylePrompt.content);
    }
  }, [prompts]);

  const updatePromptMutation = useMutation({
    mutationFn: async ({
      id,
      content,
      systemContent,
      inheritGlobalPrompt,
    }: {
      id: string;
      content: string;
      systemContent: string | null;
      inheritGlobalPrompt: number;
    }) => {
      return await apiRequest("PUT", `/api/admin/prompt_templates/${id}`, {
        content,
        systemContent,
        inheritGlobalPrompt,
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

  const createImagePromptMutation = useMutation({
    mutationFn: async (imagePromptData: any) => {
      return await apiRequest("POST", "/api/admin/image_prompts", imagePromptData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/image_prompts"] });
      setIsCreatingImagePrompt(false);
      setSelectedImagePrompt(null);
      setImagePromptForm({ ...defaultImagePromptForm });
      toast({
        title: "Image Prompt Created",
        description: "The image prompt template has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Creation Failed",
        description: "Failed to create the image prompt template.",
        variant: "destructive",
      });
    },
  });

  const updateImagePromptMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & any) => {
      return await apiRequest("PUT", `/api/admin/image_prompts/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/image_prompts"] });
      toast({
        title: "Image Prompt Updated",
        description: "The image prompt template has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update the image prompt template.",
        variant: "destructive",
      });
    },
  });

  const handleSelectImagePrompt = (imagePrompt: ImagePrompt) => {
    setSelectedImagePrompt(imagePrompt);
    setIsCreatingImagePrompt(false);
    setImagePromptForm({
      name: imagePrompt.name,
      promptTemplate: imagePrompt.promptTemplate,
      inheritVisualStyle: imagePrompt.inheritVisualStyle ?? 1,
      size: imagePrompt.size || "1024x1024",
      quality: imagePrompt.quality || "auto",
      description: imagePrompt.description || "",
      sceneTypes: imagePrompt.sceneTypes || "",
      tags: imagePrompt.tags || "",
      active: imagePrompt.active,
    });
  };

  const handleCreateNewImagePrompt = () => {
    setSelectedImagePrompt(null);
    setIsCreatingImagePrompt(true);
    setImagePromptForm({ ...defaultImagePromptForm });
  };

  const handleSaveImagePrompt = () => {
    if (isCreatingImagePrompt) {
      createImagePromptMutation.mutate(imagePromptForm);
    } else if (selectedImagePrompt) {
      updateImagePromptMutation.mutate({
        id: selectedImagePrompt.id,
        ...imagePromptForm,
      });
    }
  };

  const handleSaveVisualStyle = () => {
    const visualStylePrompt = prompts?.find((prompt) => prompt.name === "visual_style_prompt");
    if (!visualStylePrompt) {
      toast({
        title: "Prompt not found",
        description: "Unable to locate the visual_style_prompt template.",
        variant: "destructive",
      });
      return;
    }

    updatePromptMutation.mutate({
      id: visualStylePrompt.id,
      content: visualStyleContent,
      systemContent: null,
      inheritGlobalPrompt: 0,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Visual Style Prompt</CardTitle>
          <CardDescription>
            Shared tone and art direction for image prompts that inherit it. Manage other global image settings from the
            Settings tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="visual-style" data-testid="label-visual-style">
                Visual Style Prompt
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                This shared visual style will be prepended to all image generation prompts that have &quot;Inherit Visual
                Style&quot; enabled.
              </p>
              <Textarea
                id="visual-style"
                value={visualStyleContent}
                onChange={(event) => setVisualStyleContent(event.target.value)}
                placeholder="Enter the shared visual style description for all image generation..."
                className="min-h-[200px] font-mono text-sm"
                data-testid="textarea-visual-style"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveVisualStyle} disabled={updatePromptMutation.isPending} data-testid="button-save-visual-style">
                <Save className="h-4 w-4 mr-2" />
                {updatePromptMutation.isPending ? "Saving..." : "Save Visual Style"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Image Prompt Templates</CardTitle>
                  <CardDescription>
                    Manage AI image generation prompt templates with variables like CURRENT_NARRATIVE
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              {imagePromptsLoading ? (
                <p className="text-muted-foreground">Loading image prompts...</p>
              ) : (
                <div className="space-y-2">
                  <Button
                    variant="default"
                    className="w-full justify-start mb-2"
                    onClick={handleCreateNewImagePrompt}
                    data-testid="button-create-new-image-prompt"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create New Image Prompt
                  </Button>
                  {imagePrompts?.map((prompt) => (
                    <div key={prompt.id} className="flex gap-2">
                      <Button
                        variant={selectedImagePrompt?.id === prompt.id ? "secondary" : "ghost"}
                        className="flex-1 justify-start"
                        onClick={() => handleSelectImagePrompt(prompt)}
                        data-testid={`button-image-prompt-${prompt.name}`}
                      >
                        <div className="flex flex-col items-start w-full">
                          <div className="font-semibold">{prompt.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {prompt.active ? "Active" : "Inactive"} • {prompt.sceneTypes || "No scene types"}
                          </div>
                        </div>
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          setTestImagePrompt(prompt);
                          setShowTestModal(true);
                        }}
                        data-testid={`button-test-${prompt.name}`}
                        title="Test Generate"
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {isCreatingImagePrompt
                ? "Create New Image Prompt"
                : selectedImagePrompt
                ? `Edit: ${selectedImagePrompt.name}`
                : "Select an Image Prompt"}
            </CardTitle>
            <CardDescription>
              {isCreatingImagePrompt || selectedImagePrompt
                ? "Configure the image prompt template. Use template variables in double curly braces."
                : "Select an image prompt from the list or create a new one"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedImagePrompt || isCreatingImagePrompt ? (
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="image-prompt-name" data-testid="label-image-prompt-name">
                      Name
                    </Label>
                    <Input
                      id="image-prompt-name"
                      value={imagePromptForm.name}
                      onChange={(event) => setImagePromptForm({ ...imagePromptForm, name: event.target.value })}
                      placeholder="e.g. Current Scene Visualization"
                      data-testid="input-image-prompt-name"
                    />
                  </div>

                  <div>
                    <Label htmlFor="image-prompt-template" data-testid="label-image-prompt-template">
                      Prompt Template
                    </Label>
                    <Textarea
                      id="image-prompt-template"
                      value={imagePromptForm.promptTemplate}
                      onChange={(event) =>
                        setImagePromptForm({ ...imagePromptForm, promptTemplate: event.target.value })
                      }
                      placeholder="Visualize: {{CURRENT_NARRATIVE}}"
                      className="min-h-[200px] font-mono text-sm"
                      data-testid="input-image-prompt-template"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use variables: CURRENT_NARRATIVE, SEGMENT, DAY, HULL, etc. (wrap in double curly braces)
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="image-prompt-size" data-testid="label-image-prompt-size">
                        Image Size
                      </Label>
                      <Select
                        value={imagePromptForm.size}
                        onValueChange={(value) => setImagePromptForm({ ...imagePromptForm, size: value })}
                      >
                        <SelectTrigger id="image-prompt-size" data-testid="select-image-prompt-size">
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1024x1024">1024x1024 (Square)</SelectItem>
                          <SelectItem value="1536x1024">1536x1024 (Landscape)</SelectItem>
                          <SelectItem value="1024x1536">1024x1536 (Portrait)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="image-prompt-quality" data-testid="label-image-prompt-quality">
                        Quality
                      </Label>
                      <Select
                        value={imagePromptForm.quality}
                        onValueChange={(value) => setImagePromptForm({ ...imagePromptForm, quality: value })}
                      >
                        <SelectTrigger id="image-prompt-quality" data-testid="select-image-prompt-quality">
                          <SelectValue placeholder="Select quality" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto (Default)</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="image-prompt-description" data-testid="label-image-prompt-description">
                      Description
                    </Label>
                    <Textarea
                      id="image-prompt-description"
                      value={imagePromptForm.description}
                      onChange={(event) => setImagePromptForm({ ...imagePromptForm, description: event.target.value })}
                      placeholder="Optional description of when to use this template"
                      className="min-h-[80px]"
                      data-testid="input-image-prompt-description"
                    />
                  </div>

                  <div>
                    <Label htmlFor="image-prompt-scene-types" data-testid="label-image-prompt-scene-types">
                      Scene Types (comma-separated)
                    </Label>
                    <Input
                      id="image-prompt-scene-types"
                      value={imagePromptForm.sceneTypes}
                      onChange={(event) => setImagePromptForm({ ...imagePromptForm, sceneTypes: event.target.value })}
                      placeholder="e.g. narrative, event, npc"
                      data-testid="input-image-prompt-scene-types"
                    />
                  </div>

                  <div>
                    <Label htmlFor="image-prompt-tags" data-testid="label-image-prompt-tags">
                      Tags (comma-separated)
                    </Label>
                    <Input
                      id="image-prompt-tags"
                      value={imagePromptForm.tags}
                      onChange={(event) => setImagePromptForm({ ...imagePromptForm, tags: event.target.value })}
                      placeholder="e.g. space, ship, crew"
                      data-testid="input-image-prompt-tags"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="image-prompt-inherit-visual-style"
                      checked={imagePromptForm.inheritVisualStyle === 1}
                      onCheckedChange={(checked) =>
                        setImagePromptForm({ ...imagePromptForm, inheritVisualStyle: checked ? 1 : 0 })
                      }
                      data-testid="checkbox-image-prompt-inherit-visual-style"
                    />
                    <Label htmlFor="image-prompt-inherit-visual-style" data-testid="label-image-prompt-inherit-visual-style">
                      Inherit Visual Style Prompt
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="image-prompt-active"
                      checked={imagePromptForm.active === 1}
                      onCheckedChange={(checked) => setImagePromptForm({ ...imagePromptForm, active: checked ? 1 : 0 })}
                      data-testid="checkbox-image-prompt-active"
                    />
                    <Label htmlFor="image-prompt-active" data-testid="label-image-prompt-active">
                      Active
                    </Label>
                  </div>

                  <Button
                    onClick={handleSaveImagePrompt}
                    disabled={createImagePromptMutation.isPending || updateImagePromptMutation.isPending}
                    className="w-full"
                    data-testid="button-save-image-prompt"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {createImagePromptMutation.isPending || updateImagePromptMutation.isPending
                      ? "Saving..."
                      : isCreatingImagePrompt
                      ? "Create Image Prompt"
                      : "Save Changes"}
                  </Button>
                </div>
              </ScrollArea>
            ) : (
              <div className="h-[600px] flex items-center justify-center text-muted-foreground">
                Select an image prompt to edit or create a new one
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {testImagePrompt && (
        <ImageTestModal
          open={showTestModal}
          onOpenChange={setShowTestModal}
          templateName={testImagePrompt.name}
          promptTemplate={testImagePrompt.promptTemplate}
          inheritVisualStyle={testImagePrompt.inheritVisualStyle === 1}
        />
      )}
    </div>
  );
}
