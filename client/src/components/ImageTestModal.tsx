import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

interface ImageTestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  promptTemplate: string;
  inheritVisualStyle: boolean;
}

interface TestResult {
  imageUrl: string;
  promptUsed: string;
  debugInfo: {
    model: string;
    size: string;
    quality: string;
    background: string;
    moderation: string;
    generationTime: number;
    variables: Record<string, string>;
  };
}

interface ImageModel {
  modelKey: string;
  displayName?: string | null;
  provider?: string | null;
  active: number;
}

export function ImageTestModal({ open, onOpenChange, templateName, promptTemplate, inheritVisualStyle }: ImageTestModalProps) {
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [detectedVariables, setDetectedVariables] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visualStyleContent, setVisualStyleContent] = useState<string>("");
  const [selectedModelKey, setSelectedModelKey] = useState<string>("");
  const previousTemplateRef = useRef<string | null>(null);

  // Fetch prompts to get visual style
  const { data: prompts } = useQuery<any[]>({
    queryKey: ["/api/admin/prompt_templates"],
  });

  useEffect(() => {
    if (prompts) {
      const visualStylePrompt = prompts.find((p: any) => p.name === 'visual_style_prompt');
      if (visualStylePrompt) {
        setVisualStyleContent(visualStylePrompt.content);
      }
    }
  }, [prompts]);

  const { data: imageModels = [] } = useQuery<ImageModel[]>({
    queryKey: ["/api/admin/image-models"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/image-models");
      return await response.json();
    },
  });

  const activeImageModels = useMemo(
    () =>
      imageModels
        .filter((model) => model.active === 1)
        .sort((a, b) => {
          const sortA = (a as any).sortOrder ?? 0;
          const sortB = (b as any).sortOrder ?? 0;
          if (sortA !== sortB) {
            return sortA - sortB;
          }
          return a.modelKey.localeCompare(b.modelKey);
        }),
    [imageModels],
  );

  useEffect(() => {
    if (!open) {
      previousTemplateRef.current = null;
      return;
    }

    const templateChanged = previousTemplateRef.current !== promptTemplate;
    if (!templateChanged) {
      return;
    }

    previousTemplateRef.current = promptTemplate;

    // Extract variables from template using regex
    const variablePattern = /\{\{([A-Z_]+)\}\}/g;
    const matches = Array.from(promptTemplate.matchAll(variablePattern));
    const uniqueVars = Array.from(new Set(matches.map(m => m[1])));

    setDetectedVariables(uniqueVars.filter((varName) => varName !== "IMAGE_MODEL_KEY"));

    // Initialize with default values
    const defaultValues: Record<string, string> = {};
    uniqueVars.forEach(varName => {
      switch(varName) {
        case 'CURRENT_NARRATIVE':
          defaultValues[varName] = 'The ship drifts through deep space, its hull groaning under mysterious pressure.';
          break;
        case 'SEGMENT':
          defaultValues[varName] = 'Belt';
          break;
        case 'DAY':
          defaultValues[varName] = '5';
          break;
        case 'HULL':
        case 'OXYGEN':
        case 'FUEL':
        case 'FOOD':
        case 'MORALE':
          defaultValues[varName] = '75';
          break;
        case 'EQUIPPED_ITEMS':
          defaultValues[varName] = 'Duct Tape Deluxe (🔧), Manual (📖)';
          break;
        case 'NPC_SUMMARY':
          defaultValues[varName] = 'Pilot Lyra (Navigator), Engineer Grom (Chief Engineer)';
          break;
        case 'IMAGE_MODEL_KEY':
          defaultValues[varName] = '';
          break;
        default:
          defaultValues[varName] = '';
      }
    });
    
    setVariables(defaultValues);
    setResult(null);
    setError(null);
  }, [open, promptTemplate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (selectedModelKey && activeImageModels.some((model) => model.modelKey === selectedModelKey)) {
      return;
    }

    if (activeImageModels.length > 0) {
      setSelectedModelKey(activeImageModels[0].modelKey);
    }
  }, [open, activeImageModels, selectedModelKey]);

  useEffect(() => {
    if (!selectedModelKey) {
      return;
    }

    if (!promptTemplate.includes("{{IMAGE_MODEL_KEY}}")) {
      return;
    }

    setVariables((previous) => {
      if (previous["IMAGE_MODEL_KEY"] === selectedModelKey) {
        return previous;
      }
      return {
        ...previous,
        IMAGE_MODEL_KEY: selectedModelKey,
      };
    });
  }, [selectedModelKey, promptTemplate]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      if (!selectedModelKey) {
        setError("Please select an image model");
        setIsGenerating(false);
        return;
      }
      const modelKey = selectedModelKey;
      const response = await apiRequest("POST", "/api/test-generate-image", {
        templateName,
        variables: {
          ...variables,
          imageModelKey: modelKey,
        }
      });
      const data = await response.json() as TestResult;
      
      setResult(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to generate image";
      setError(errorMessage);
      console.error("Image generation error:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const getCompiledPrompt = () => {
    let compiled = promptTemplate;
    
    // Apply visual style if inherited (matches backend compilation)
    if (inheritVisualStyle && visualStyleContent) {
      compiled = [
        promptTemplate,
        "",
        `STYLE: ${visualStyleContent}`,
      ].join("\n");
    }
    
    // Replace variables
    Object.entries(variables).forEach(([key, value]) => {
      compiled = compiled.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    });
    return compiled;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Test Image Generation: {templateName}</DialogTitle>
          <DialogDescription>
            Fill in the variable values and generate a test image to verify the template and API access
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Image Model</CardTitle>
                <CardDescription>Choose which model to use for this test run</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="select-image-model" data-testid="label-test-image-model">
                  Model
                </Label>
                <Select value={selectedModelKey} onValueChange={setSelectedModelKey}>
                  <SelectTrigger id="select-image-model" data-testid="select-test-image-model">
                    <SelectValue placeholder={activeImageModels.length > 0 ? "Select a model" : "No active models configured"} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeImageModels.map((model) => (
                      <SelectItem key={model.modelKey} value={model.modelKey}>
                        {model.displayName ? `${model.displayName} (${model.modelKey})` : model.modelKey}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeImageModels.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No active models found. Configure models in the Image Models tab.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Variable Inputs */}
            {detectedVariables.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Template Variables</CardTitle>
                  <CardDescription>
                    Provide values for each variable detected in the template
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {detectedVariables.map(varName => (
                    <div key={varName}>
                      <Label htmlFor={`var-${varName}`} data-testid={`label-var-${varName.toLowerCase()}`}>
                        {varName}
                      </Label>
                      {varName === 'CURRENT_NARRATIVE' ? (
                        <Textarea
                          id={`var-${varName}`}
                          value={variables[varName] || ''}
                          onChange={(e) => setVariables({ ...variables, [varName]: e.target.value })}
                          placeholder={`Enter value for ${varName}...`}
                          className="min-h-[100px] font-mono text-sm"
                          data-testid={`input-var-${varName.toLowerCase()}`}
                        />
                      ) : (
                        <Input
                          id={`var-${varName}`}
                          value={variables[varName] || ''}
                          onChange={(e) => setVariables({ ...variables, [varName]: e.target.value })}
                          placeholder={`Enter value for ${varName}...`}
                          data-testid={`input-var-${varName.toLowerCase()}`}
                        />
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Compiled Prompt Preview */}
            <Card>
              <CardHeader>
                <CardTitle>Compiled Prompt Preview</CardTitle>
                <CardDescription>
                  This is what will be sent to the AI after variable substitution
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={getCompiledPrompt()}
                  readOnly
                  className="min-h-[120px] font-mono text-sm bg-muted"
                  data-testid="textarea-compiled-prompt"
                />
              </CardContent>
            </Card>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full"
              data-testid="button-generate-test-image"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Image...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Test Image
                </>
              )}
            </Button>

            {/* Error Display */}
            {error && (
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    Generation Failed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm" data-testid="text-error-message">{error}</p>
                </CardContent>
              </Card>
            )}

            {/* Result Display */}
            {result && (
              <>
                {/* Generated Image */}
                <Card>
                  <CardHeader>
                    <CardTitle>Generated Image</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-center bg-muted rounded-lg p-4">
                      <img 
                        src={result.imageUrl} 
                        alt="Generated test image" 
                        className="max-w-full h-auto rounded"
                        data-testid="img-generated"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Debug Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>Debug Information</CardTitle>
                    <CardDescription>
                      Technical details about the generation request
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-muted-foreground">Model</Label>
                        <p className="font-mono" data-testid="text-debug-model">{result.debugInfo.model}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Size</Label>
                        <p className="font-mono" data-testid="text-debug-size">{result.debugInfo.size}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Quality</Label>
                        <p className="font-mono" data-testid="text-debug-quality">{result.debugInfo.quality}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Background</Label>
                        <p className="font-mono" data-testid="text-debug-background">{result.debugInfo.background}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Moderation</Label>
                        <p className="font-mono" data-testid="text-debug-moderation">{result.debugInfo.moderation}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Generation Time</Label>
                        <p className="font-mono" data-testid="text-debug-time">{(result.debugInfo.generationTime / 1000).toFixed(2)}s</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-muted-foreground">Final Prompt Sent</Label>
                      <Textarea
                        value={result.promptUsed}
                        readOnly
                        className="min-h-[100px] font-mono text-sm bg-muted mt-2"
                        data-testid="textarea-final-prompt"
                      />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
