import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import { NpcTemplate } from "./types";

const defaultNpcForm = {
  name: "",
  role: "",
  personality: "",
  quirk: "",
  icon: "",
  tags: "",
  active: 1,
};

export function NpcsTab() {
  const { toast } = useToast();

  const { data: npcs, isLoading: npcsLoading } = useQuery<NpcTemplate[]>({
    queryKey: ["/api/admin/npc_templates"],
  });

  const [selectedNpc, setSelectedNpc] = useState<NpcTemplate | null>(null);
  const [isCreatingNpc, setIsCreatingNpc] = useState(false);
  const [npcForm, setNpcForm] = useState({ ...defaultNpcForm });

  const createNpcMutation = useMutation({
    mutationFn: async (npcData: any) => {
      return await apiRequest("POST", "/api/admin/npc_templates", npcData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/npc_templates"] });
      setIsCreatingNpc(false);
      setSelectedNpc(null);
      setNpcForm({ ...defaultNpcForm });
      toast({
        title: "NPC Created",
        description: "The NPC template has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Creation Failed",
        description: "Failed to create the NPC template.",
        variant: "destructive",
      });
    },
  });

  const updateNpcMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & any) => {
      return await apiRequest("PUT", `/api/admin/npc_templates/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/npc_templates"] });
      toast({
        title: "NPC Updated",
        description: "The NPC template has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update the NPC template.",
        variant: "destructive",
      });
    },
  });

  const handleSelectNpc = (npc: NpcTemplate) => {
    setSelectedNpc(npc);
    setIsCreatingNpc(false);
    setNpcForm({
      name: npc.name,
      role: npc.role,
      personality: npc.personality,
      quirk: npc.quirk,
      icon: npc.icon,
      tags: npc.tags || "",
      active: npc.active,
    });
  };

  const handleCreateNewNpc = () => {
    setSelectedNpc(null);
    setIsCreatingNpc(true);
    setNpcForm({ ...defaultNpcForm });
  };

  const handleSaveNpc = () => {
    if (isCreatingNpc) {
      createNpcMutation.mutate(npcForm);
    } else if (selectedNpc) {
      updateNpcMutation.mutate({
        id: selectedNpc.id,
        ...npcForm,
      });
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>NPC Templates</CardTitle>
              <CardDescription>Manage recurring characters and crew</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCreateNewNpc} data-testid="button-create-npc">
              <Plus className="h-4 w-4 mr-2" />
              New NPC
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {npcsLoading ? (
              <p className="text-muted-foreground">Loading NPCs...</p>
            ) : (
              <div className="space-y-2">
                {npcs?.map((npc) => (
                  <Button
                    key={npc.id}
                    variant={selectedNpc?.id === npc.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleSelectNpc(npc)}
                    data-testid={`button-npc-${npc.name}`}
                  >
                    <div className="flex flex-col items-start w-full">
                      <div className="font-semibold">{npc.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {npc.role} • {npc.active ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {isCreatingNpc ? "Create New NPC" : selectedNpc ? `Edit: ${selectedNpc.name}` : "Select an NPC"}
          </CardTitle>
          <CardDescription>
            {isCreatingNpc || selectedNpc
              ? "Define personality traits, quirks, and how this NPC fits the story"
              : "Choose an NPC from the list to edit"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCreatingNpc || selectedNpc ? (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label htmlFor="npc-name">Name</Label>
                  <Input
                    id="npc-name"
                    value={npcForm.name}
                    onChange={(event) => setNpcForm({ ...npcForm, name: event.target.value })}
                    placeholder="e.g., Captain Mira"
                    data-testid="input-npc-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="npc-role">Role</Label>
                  <Input
                    id="npc-role"
                    value={npcForm.role}
                    onChange={(event) => setNpcForm({ ...npcForm, role: event.target.value })}
                    placeholder="Position or contribution to the crew"
                    data-testid="input-npc-role"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="npc-personality">Personality</Label>
                  <Textarea
                    id="npc-personality"
                    value={npcForm.personality}
                    onChange={(event) => setNpcForm({ ...npcForm, personality: event.target.value })}
                    placeholder="Describe the NPC's personality traits"
                    className="min-h-[120px]"
                    data-testid="textarea-npc-personality"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="npc-quirk">Quirk</Label>
                  <Textarea
                    id="npc-quirk"
                    value={npcForm.quirk}
                    onChange={(event) => setNpcForm({ ...npcForm, quirk: event.target.value })}
                    placeholder="Unique behaviors or quirks"
                    className="min-h-[120px]"
                    data-testid="textarea-npc-quirk"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="npc-icon">Icon</Label>
                  <Input
                    id="npc-icon"
                    value={npcForm.icon}
                    onChange={(event) => setNpcForm({ ...npcForm, icon: event.target.value })}
                    placeholder="emoji or icon path"
                    data-testid="input-npc-icon"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="npc-tags">Tags (comma-separated)</Label>
                  <Input
                    id="npc-tags"
                    value={npcForm.tags}
                    onChange={(event) => setNpcForm({ ...npcForm, tags: event.target.value })}
                    placeholder="e.g., mentor, scientist"
                    data-testid="input-npc-tags"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="npc-active"
                    checked={npcForm.active === 1}
                    onCheckedChange={(checked) => setNpcForm({ ...npcForm, active: checked ? 1 : 0 })}
                    data-testid="checkbox-npc-active"
                  />
                  <Label htmlFor="npc-active">Active</Label>
                </div>

                <Button
                  onClick={handleSaveNpc}
                  disabled={createNpcMutation.isPending || updateNpcMutation.isPending}
                  className="w-full"
                  data-testid="button-save-npc"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createNpcMutation.isPending || updateNpcMutation.isPending
                    ? "Saving..."
                    : isCreatingNpc
                    ? "Create NPC"
                    : "Save Changes"}
                </Button>
              </div>
            </ScrollArea>
          ) : (
            <div className="h-[600px] flex items-center justify-center text-muted-foreground">
              Select an NPC to edit or create a new one
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
