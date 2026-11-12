import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save, Plus } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import { AppSetting } from "./types";

export function SettingsTab() {
  const { toast } = useToast();

  const {
    data: settings = [],
    isLoading: settingsLoading,
    refetch: refetchSettings,
  } = useQuery<AppSetting[]>({
    queryKey: ["/api/settings"],
  });

  const [imageCacheRetentionDays, setImageCacheRetentionDays] = useState("30");
  const [imageCacheMinAccessCount, setImageCacheMinAccessCount] = useState("5");
  const [selectedSettingKey, setSelectedSettingKey] = useState<string | null>(null);
  const [isCreatingSetting, setIsCreatingSetting] = useState(false);
  const [settingForm, setSettingForm] = useState({
    key: "",
    value: "",
    description: "",
    active: 1 as 0 | 1,
  });

  useEffect(() => {
    const visualRetention = settings.find((setting) => setting.key === "image_cache_retention_days");
    if (visualRetention) {
      setImageCacheRetentionDays(visualRetention.value);
    }

    const minAccessCount = settings.find((setting) => setting.key === "image_cache_min_access_count");
    if (minAccessCount) {
      setImageCacheMinAccessCount(minAccessCount.value);
    }
  }, [settings]);

  useEffect(() => {
    if (!selectedSettingKey) {
      return;
    }

    const currentSetting = settings.find((setting) => setting.key === selectedSettingKey);
    if (currentSetting) {
      setSettingForm({
        key: currentSetting.key,
        value: currentSetting.value ?? "",
        description: currentSetting.description ?? "",
        active: (currentSetting.active ?? 1) as 0 | 1,
      });
    }
  }, [settings, selectedSettingKey]);

  const upsertSettingMutation = useMutation({
    mutationFn: async ({
      key,
      value,
      description,
      active,
    }: {
      key: string;
      value: string;
      description?: string;
      active?: number;
    }) => {
      const response = await apiRequest("PUT", `/api/settings/${encodeURIComponent(key)}`, {
        value,
        description,
        active,
      });
      return await response.json();
    },
    onSuccess: () => {
      refetchSettings();
      toast({ title: "Setting saved", description: "The setting has been updated." });
    },
    onError: () => {
      toast({
        title: "Save failed",
        description: "Failed to save setting.",
        variant: "destructive",
      });
    },
  });

  const resetSettingForm = () => {
    setSettingForm({
      key: "",
      value: "",
      description: "",
      active: 1,
    });
  };

  const handleCreateNewSetting = () => {
    resetSettingForm();
    setSelectedSettingKey(null);
    setIsCreatingSetting(true);
  };

  const handleSelectSetting = (setting: AppSetting) => {
    setIsCreatingSetting(false);
    setSelectedSettingKey(setting.key);
    setSettingForm({
      key: setting.key,
      value: setting.value ?? "",
      description: setting.description ?? "",
      active: (setting.active ?? 1) as 0 | 1,
    });
  };

  const handleSaveSetting = () => {
    const trimmedKey = settingForm.key.trim();

    if (!trimmedKey) {
      toast({
        title: "Setting key required",
        description: "Provide a unique setting key before saving.",
        variant: "destructive",
      });
      return;
    }

    upsertSettingMutation.mutate(
      {
        key: trimmedKey,
        value: settingForm.value,
        description: settingForm.description || undefined,
        active: settingForm.active,
      },
      {
        onSuccess: () => {
          setIsCreatingSetting(false);
          setSelectedSettingKey(trimmedKey);
          setSettingForm((previous) => ({
            ...previous,
            key: trimmedKey,
          }));
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Application Settings</CardTitle>
          <CardDescription>Global knobs exported with references</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="settings-cache-retention">Image Cache Retention (days)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Images older than this will be eligible for cleanup based on usage.
                </p>
                <Input
                  id="settings-cache-retention"
                  type="number"
                  min="1"
                  max="180"
                  value={imageCacheRetentionDays}
                  onChange={(event) => setImageCacheRetentionDays(event.target.value)}
                  className="w-full"
                />
                <div className="flex justify-end mt-2">
                  <Button
                    onClick={() =>
                      upsertSettingMutation.mutate({
                        key: "image_cache_retention_days",
                        value: imageCacheRetentionDays,
                        description: "Number of days to retain images in cache",
                        active: 1,
                      })
                    }
                    disabled={upsertSettingMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {upsertSettingMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="settings-cache-access-count">Image Cache Minimum Access Count</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Minimum number of times an image must be accessed to be retained.
                </p>
                <Input
                  id="settings-cache-access-count"
                  type="number"
                  min="1"
                  max="100"
                  value={imageCacheMinAccessCount}
                  onChange={(event) => setImageCacheMinAccessCount(event.target.value)}
                  className="w-full"
                />
                <div className="flex justify-end mt-2">
                  <Button
                    onClick={() =>
                      upsertSettingMutation.mutate({
                        key: "image_cache_min_access_count",
                        value: imageCacheMinAccessCount,
                        description: "Minimum access count to keep images",
                        active: 1,
                      })
                    }
                    disabled={upsertSettingMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {upsertSettingMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <Label>All Settings</Label>
              <div className="text-xs text-muted-foreground mb-2">Live view from /api/settings</div>
              <div className="rounded border divide-y">
                {settingsLoading && <div className="p-2 text-sm text-muted-foreground">Loading settings...</div>}
                {!settingsLoading &&
                  (settings || []).map((setting) => (
                    <div key={setting.key} className="grid grid-cols-4 gap-2 p-2 text-sm">
                      <div className="font-mono col-span-1 break-all">{setting.key}</div>
                      <div className="font-mono col-span-2 break-all">{setting.value}</div>
                      <div className="text-muted-foreground col-span-1 break-all">
                        {setting.description || ""}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Settings</CardTitle>
                <CardDescription>Live view from /api/settings</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleCreateNewSetting} data-testid="button-create-setting">
                <Plus className="h-4 w-4 mr-2" />
                New Setting
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {settings && settings.length > 0 ? (
                <div className="space-y-2">
                  {settings.map((setting) => (
                    <Button
                      key={setting.key}
                      variant={!isCreatingSetting && selectedSettingKey === setting.key ? "secondary" : "ghost"}
                      className="w-full justify-start text-left"
                      onClick={() => handleSelectSetting(setting)}
                      data-testid={`button-setting-${setting.key}`}
                    >
                      <div className="flex flex-col items-start w-full">
                        <div className="font-mono text-xs break-all">{setting.key}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2 w-full">
                          {setting.description && setting.description.trim().length > 0
                            ? setting.description
                            : "No description"}
                        </div>
                        <div className="text-xs text-muted-foreground w-full truncate">Value: {setting.value}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No settings found. Create one to get started.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {isCreatingSetting
                ? "Create New Setting"
                : selectedSettingKey
                ? `Edit: ${settingForm.key}`
                : "Select a Setting"}
            </CardTitle>
            <CardDescription>
              {isCreatingSetting
                ? "Define a new key/value pair for global configuration."
                : selectedSettingKey
                ? "Update the stored value, description, or activation state."
                : "Choose a setting from the list or create a new one."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isCreatingSetting || selectedSettingKey ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="setting-key">Key</Label>
                  <Input
                    id="setting-key"
                    value={settingForm.key}
                    onChange={(event) => setSettingForm((previous) => ({ ...previous, key: event.target.value }))}
                    placeholder="e.g., image_background_setting"
                    disabled={!isCreatingSetting}
                    data-testid="input-setting-key"
                  />
                  {!isCreatingSetting && (
                    <p className="text-xs text-muted-foreground">
                      Keys are immutable. Create a new setting if you need to change the key.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setting-value">Value</Label>
                  <Textarea
                    id="setting-value"
                    value={settingForm.value}
                    onChange={(event) =>
                      setSettingForm((previous) => ({ ...previous, value: event.target.value }))
                    }
                    placeholder="Enter the setting value. Use JSON if structured data is required."
                    className="min-h-[140px] font-mono text-sm"
                    data-testid="textarea-setting-value"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setting-description">Description</Label>
                  <Textarea
                    id="setting-description"
                    value={settingForm.description}
                    onChange={(event) =>
                      setSettingForm((previous) => ({ ...previous, description: event.target.value }))
                    }
                    placeholder="Explain how this setting is used."
                    className="min-h-[100px]"
                    data-testid="textarea-setting-description"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="setting-active"
                    checked={settingForm.active === 1}
                    onCheckedChange={(checked) =>
                      setSettingForm((previous) => ({ ...previous, active: checked ? 1 : 0 }))
                    }
                    data-testid="checkbox-setting-active"
                  />
                  <Label htmlFor="setting-active" className="cursor-pointer">
                    Active
                  </Label>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSetting}
                    disabled={upsertSettingMutation.isPending}
                    data-testid="button-save-setting"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {upsertSettingMutation.isPending ? "Saving..." : "Save Setting"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                Select a setting to edit or create a new one
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
