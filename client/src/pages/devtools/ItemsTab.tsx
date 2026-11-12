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

import { Item } from "./types";

const defaultItemForm = {
  name: "",
  description: "",
  icon: "",
  skillBonus: "{}",
  sceneEffect: "{}",
  tags: "",
  active: 1,
};

export function ItemsTab() {
  const { toast } = useToast();

  const { data: items, isLoading: itemsLoading } = useQuery<Item[]>({
    queryKey: ["/api/admin/items"],
  });

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [itemForm, setItemForm] = useState({ ...defaultItemForm });

  const createItemMutation = useMutation({
    mutationFn: async (itemData: any) => {
      return await apiRequest("POST", "/api/admin/items", itemData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      setIsCreatingItem(false);
      setSelectedItem(null);
      setItemForm({ ...defaultItemForm });
      toast({
        title: "Item Created",
        description: "The item has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Creation Failed",
        description: "Failed to create the item.",
        variant: "destructive",
      });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & any) => {
      return await apiRequest("PUT", `/api/admin/items/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      toast({
        title: "Item Updated",
        description: "The item has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update the item.",
        variant: "destructive",
      });
    },
  });

  const handleSelectItem = (item: Item) => {
    setSelectedItem(item);
    setIsCreatingItem(false);
    setItemForm({
      name: item.name,
      description: item.description,
      icon: item.icon,
      skillBonus:
        typeof item.skillBonus === "string" ? item.skillBonus : JSON.stringify(item.skillBonus || {}, null, 2),
      sceneEffect:
        typeof item.sceneEffect === "string" ? item.sceneEffect : JSON.stringify(item.sceneEffect || {}, null, 2),
      tags: item.tags || "",
      active: item.active,
    });
  };

  const handleCreateNewItem = () => {
    setSelectedItem(null);
    setIsCreatingItem(true);
    setItemForm({ ...defaultItemForm });
  };

  const handleSaveItem = () => {
    const itemData = {
      ...itemForm,
      skillBonus: itemForm.skillBonus ? JSON.parse(itemForm.skillBonus) : null,
      sceneEffect: itemForm.sceneEffect ? JSON.parse(itemForm.sceneEffect) : null,
    };

    if (isCreatingItem) {
      createItemMutation.mutate(itemData);
    } else if (selectedItem) {
      updateItemMutation.mutate({
        id: selectedItem.id,
        ...itemData,
      });
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Items</CardTitle>
              <CardDescription>Manage crew equipment and bonuses</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCreateNewItem} data-testid="button-create-item">
              <Plus className="h-4 w-4 mr-2" />
              New Item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {itemsLoading ? (
              <p className="text-muted-foreground">Loading items...</p>
            ) : (
              <div className="space-y-2">
                {items?.map((item) => (
                  <Button
                    key={item.id}
                    variant={selectedItem?.id === item.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleSelectItem(item)}
                    data-testid={`button-item-${item.name}`}
                  >
                    <div className="flex flex-col items-start w-full">
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.icon} • {item.active ? "Active" : "Inactive"}
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
            {isCreatingItem ? "Create New Item" : selectedItem ? `Edit: ${selectedItem.name}` : "Select an item"}
          </CardTitle>
          <CardDescription>
            {isCreatingItem || selectedItem
              ? "Configure item properties and effects"
              : "Choose an item from the list to edit"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCreatingItem || selectedItem ? (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label htmlFor="item-name">Item Name</Label>
                  <Input
                    id="item-name"
                    value={itemForm.name}
                    onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                    placeholder="e.g., Quantum Toolkit"
                    data-testid="input-item-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item-description">Description</Label>
                  <Textarea
                    id="item-description"
                    value={itemForm.description}
                    onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })}
                    placeholder="Describe the item and how it helps the crew"
                    className="min-h-[120px]"
                    data-testid="textarea-item-description"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item-icon">Icon</Label>
                  <Input
                    id="item-icon"
                    value={itemForm.icon}
                    onChange={(event) => setItemForm({ ...itemForm, icon: event.target.value })}
                    placeholder="emoji or icon path"
                    data-testid="input-item-icon"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item-skill-bonus">Skill Bonus (JSON)</Label>
                  <Textarea
                    id="item-skill-bonus"
                    value={itemForm.skillBonus}
                    onChange={(event) => setItemForm({ ...itemForm, skillBonus: event.target.value })}
                    className="min-h-[140px] font-mono text-sm"
                    placeholder='{"Engineering": 2, "Navigation": 1}'
                    data-testid="textarea-item-skill-bonus"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item-scene-effect">Scene Effect (JSON)</Label>
                  <Textarea
                    id="item-scene-effect"
                    value={itemForm.sceneEffect}
                    onChange={(event) => setItemForm({ ...itemForm, sceneEffect: event.target.value })}
                    className="min-h-[140px] font-mono text-sm"
                    placeholder='{"type": "boost", "value": "Provide extra oxygen"}'
                    data-testid="textarea-item-scene-effect"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item-tags">Tags (comma-separated)</Label>
                  <Input
                    id="item-tags"
                    value={itemForm.tags}
                    onChange={(event) => setItemForm({ ...itemForm, tags: event.target.value })}
                    placeholder="e.g., engineering, morale"
                    data-testid="input-item-tags"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="item-active"
                    checked={itemForm.active === 1}
                    onCheckedChange={(checked) => setItemForm({ ...itemForm, active: checked ? 1 : 0 })}
                    data-testid="checkbox-item-active"
                  />
                  <Label htmlFor="item-active">Active</Label>
                </div>

                <Button
                  onClick={handleSaveItem}
                  disabled={createItemMutation.isPending || updateItemMutation.isPending}
                  className="w-full"
                  data-testid="button-save-item"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createItemMutation.isPending || updateItemMutation.isPending
                    ? "Saving..."
                    : isCreatingItem
                    ? "Create Item"
                    : "Save Changes"}
                </Button>
              </div>
            </ScrollArea>
          ) : (
            <div className="h-[600px] flex items-center justify-center text-muted-foreground">
              Select an item to edit or create a new one
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
