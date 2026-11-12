import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PCE_VARIABLES,
  getVariablesByCategory,
  type PceStage,
  type PceVariable,
  isVariableAvailableForStage,
} from "../pceVariables";

interface PceVariableReferenceProps {
  stage: PceStage | null;
}

export function PceVariableReference({ stage }: PceVariableReferenceProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [copiedVariable, setCopiedVariable] = useState<string | null>(null);
  const variablesByCategory = getVariablesByCategory();

  const handleCopyVariable = async (variableName: string) => {
    const variableText = `{{${variableName}}}`;
    await navigator.clipboard.writeText(variableText);
    setCopiedVariable(variableName);
    setTimeout(() => setCopiedVariable(null), 2000);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between mb-2">
          <span className="font-semibold">PCE Variables Reference</span>
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Available Variables</CardTitle>
            <CardDescription className="text-xs">
              {stage
                ? `Variables available for ${stage} stage. Click to copy.`
                : "All PCE variables. Click to copy."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <div className="p-4 space-y-4">
                {Object.entries(variablesByCategory).map(([category, variables]) => {
                  const categoryVariables = variables.filter((v) =>
                    isVariableAvailableForStage(v, stage)
                  );

                  if (categoryVariables.length === 0) {
                    return null;
                  }

                  return (
                    <div key={category} className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground border-b pb-1">
                        {category}
                      </h4>
                      <div className="space-y-1">
                        {categoryVariables.map((variable) => {
                          const isAvailable = isVariableAvailableForStage(variable, stage);
                          const isCopied = copiedVariable === variable.name;

                          return (
                            <TooltipProvider key={variable.name}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={`flex items-center justify-between p-2 rounded-md hover:bg-accent cursor-pointer transition-colors ${
                                      isAvailable && stage
                                        ? "bg-accent/50 font-medium"
                                        : ""
                                    }`}
                                    onClick={() => handleCopyVariable(variable.name)}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <code className="text-xs text-primary">
                                        {`{{${variable.name}}}`}
                                      </code>
                                      {variable.description && (
                                        <p className="text-xs text-muted-foreground mt-1 truncate">
                                          {variable.description}
                                        </p>
                                      )}
                                    </div>
                                    <div className="ml-2 flex-shrink-0">
                                      {isCopied ? (
                                        <Check className="h-4 w-4 text-green-500" />
                                      ) : (
                                        <Copy className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs">
                                  <div className="space-y-1">
                                    <p className="font-semibold">{variable.name}</p>
                                    <p className="text-sm">{variable.description}</p>
                                    {variable.example && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Example: {variable.example}
                                      </p>
                                    )}
                                    {stage && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Available in: {variable.availableIn.join(", ")}
                                      </p>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

