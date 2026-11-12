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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { Event } from "./types";

const defaultEventForm = {
  name: "",
  segment: "Moon Flyby",
  skill: "Engineering",
  dc: 12,
  triggerCondition: "{}",
  passEffect: "",
  failEffect: "",
  tags: "",
  active: 1,
};

export function EventsTab() {
  const { toast } = useToast();
  const { data: events, isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/admin/events"],
  });

  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ ...defaultEventForm });

  const createEventMutation = useMutation({
    mutationFn: async (eventData: typeof defaultEventForm) => {
      return await apiRequest("POST", "/api/admin/events", eventData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      setIsCreatingEvent(false);
      setEventForm({ ...defaultEventForm });
      toast({
        title: "Event Created",
        description: "The event has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Creation Failed",
        description: "Failed to create the event.",
        variant: "destructive",
      });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<typeof defaultEventForm>) => {
      return await apiRequest("PUT", `/api/admin/events/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      toast({
        title: "Event Updated",
        description: "The event has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update the event.",
        variant: "destructive",
      });
    },
  });

  const handleSelectEvent = (event: Event) => {
    setSelectedEvent(event);
    setIsCreatingEvent(false);
    setEventForm({
      name: event.name,
      segment: event.segment,
      skill: event.skill,
      dc: event.dc,
      triggerCondition:
        typeof event.triggerCondition === "string"
          ? event.triggerCondition
          : JSON.stringify(event.triggerCondition, null, 2),
      passEffect: event.passEffect,
      failEffect: event.failEffect,
      tags: event.tags || "",
      active: event.active,
    });
  };

  const handleCreateNewEvent = () => {
    setSelectedEvent(null);
    setIsCreatingEvent(true);
    setEventForm({ ...defaultEventForm });
  };

  const handleSaveEvent = () => {
    if (isCreatingEvent) {
      createEventMutation.mutate(eventForm);
    } else if (selectedEvent) {
      updateEventMutation.mutate({
        id: selectedEvent.id,
        ...eventForm,
      });
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Events</CardTitle>
              <CardDescription>Manage procedural events and triggers</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCreateNewEvent} data-testid="button-create-event">
                <Plus className="h-4 w-4 mr-2" />
                New Event
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {eventsLoading ? (
              <p className="text-muted-foreground">Loading events...</p>
            ) : (
              <div className="space-y-2">
                {events?.map((event) => (
                  <Button
                    key={event.id}
                    variant={selectedEvent?.id === event.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleSelectEvent(event)}
                    data-testid={`button-event-${event.name}`}
                  >
                    <div className="flex flex-col items-start w-full">
                      <div className="font-semibold">{event.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {event.segment} • {event.skill} (DC {event.dc}) • {event.active ? "Active" : "Inactive"}
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
            {isCreatingEvent ? "Create New Event" : selectedEvent ? `Edit: ${selectedEvent.name}` : "Select an event"}
          </CardTitle>
          <CardDescription>
            {isCreatingEvent || selectedEvent
              ? "Configure event parameters and trigger conditions"
              : "Choose an event from the list to edit"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCreatingEvent || selectedEvent ? (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label htmlFor="event-name">Event Name</Label>
                  <Input
                    id="event-name"
                    value={eventForm.name}
                    onChange={(event) => setEventForm({ ...eventForm, name: event.target.value })}
                    placeholder="e.g., Asteroid Belt Surprise"
                    data-testid="input-event-name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="event-segment">Segment</Label>
                    <Select
                      value={eventForm.segment}
                      onValueChange={(value) => setEventForm({ ...eventForm, segment: value })}
                    >
                      <SelectTrigger id="event-segment" data-testid="select-event-segment">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DepartureEarth">Launch from Earth</SelectItem>
                        <SelectItem value="Moon">Moon Flyby</SelectItem>
                        <SelectItem value="Mars">Earth to Mars</SelectItem>
                        <SelectItem value="Belt">Asteroid Belt</SelectItem>
                        <SelectItem value="JupiterSaturn">Jupiter to Saturn</SelectItem>
                        <SelectItem value="OuterDarkness">Outer Darkness</SelectItem>
                        <SelectItem value="NearUranus">Approaching Uranus</SelectItem>
                        <SelectItem value="ArrivalUranus">Arrival on Uranus</SelectItem>
                        <SelectItem value="Lost">Lost</SelectItem>
                        <SelectItem value="Any">Any</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="event-skill">Skill</Label>
                    <Select value={eventForm.skill} onValueChange={(value) => setEventForm({ ...eventForm, skill: value })}>
                      <SelectTrigger id="event-skill" data-testid="select-event-skill">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Leadership">Leadership</SelectItem>
                        <SelectItem value="Science">Science</SelectItem>
                        <SelectItem value="Engineering">Engineering</SelectItem>
                        <SelectItem value="Navigation">Navigation</SelectItem>
                        <SelectItem value="Diplomacy">Diplomacy</SelectItem>
                        <SelectItem value="Morale">Morale</SelectItem>
                        <SelectItem value="Combat">Combat</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="event-dc">Difficulty Class</Label>
                    <Input
                      id="event-dc"
                      type="number"
                      min={1}
                      max={30}
                      value={eventForm.dc}
                      onChange={(event) =>
                        setEventForm({ ...eventForm, dc: Number.parseInt(event.target.value || "0", 10) })
                      }
                      data-testid="input-event-dc"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="event-tags">Tags (comma-separated)</Label>
                    <Input
                      id="event-tags"
                      value={eventForm.tags}
                      onChange={(event) => setEventForm({ ...eventForm, tags: event.target.value })}
                      placeholder="e.g., critical, exploration"
                      data-testid="input-event-tags"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-trigger">Trigger Condition (JSON)</Label>
                  <Textarea
                    id="event-trigger"
                    value={eventForm.triggerCondition}
                    onChange={(event) => setEventForm({ ...eventForm, triggerCondition: event.target.value })}
                    className="min-h-[140px] font-mono text-sm"
                    placeholder='{"type": "onSegment", "value": "Moon Flyby"}'
                    data-testid="textarea-event-trigger"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-pass-effect">Pass Effect</Label>
                  <Textarea
                    id="event-pass-effect"
                    value={eventForm.passEffect}
                    onChange={(event) => setEventForm({ ...eventForm, passEffect: event.target.value })}
                    placeholder="Describe outcomes when the crew succeeds"
                    className="min-h-[120px]"
                    data-testid="textarea-event-pass-effect"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-fail-effect">Fail Effect</Label>
                  <Textarea
                    id="event-fail-effect"
                    value={eventForm.failEffect}
                    onChange={(event) => setEventForm({ ...eventForm, failEffect: event.target.value })}
                    placeholder="Describe outcomes when the crew fails"
                    className="min-h-[120px]"
                    data-testid="textarea-event-fail-effect"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="event-active"
                    checked={eventForm.active === 1}
                    onCheckedChange={(checked) => setEventForm({ ...eventForm, active: checked ? 1 : 0 })}
                    data-testid="checkbox-event-active"
                  />
                  <Label htmlFor="event-active">Active</Label>
                </div>

                <Button
                  onClick={handleSaveEvent}
                  disabled={createEventMutation.isPending || updateEventMutation.isPending}
                  className="w-full"
                  data-testid="button-save-event"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createEventMutation.isPending || updateEventMutation.isPending
                    ? "Saving..."
                    : isCreatingEvent
                    ? "Create Event"
                    : "Save Changes"}
                </Button>
              </div>
            </ScrollArea>
          ) : (
            <div className="h-[600px] flex items-center justify-center text-muted-foreground">
              Select an event to edit or create a new one
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
