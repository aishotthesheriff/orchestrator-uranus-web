# Engineering and Architecture Guide: Adding New DevTools
_Comprehensive guide for architects and game mechanics specialists_

**Target Audience:** Architects and Game Mechanics Specialists  
**Last Updated:** 2025-01-27 UTC

---

## Table of Contents

1. [Context & Overview](#context--overview)
2. [Technical Details](#technical-details)
3. [Practical Guidance](#practical-guidance)
4. [Troubleshooting & Support](#troubleshooting--support)
5. [Standards & Processes](#standards--processes)
6. [Visual Aids](#visual-aids)
7. [Cross-References](#cross-references)

---

## Context & Overview

### What This Guide Covers

This guide provides step-by-step instructions for adding new DevTools tabs to the Quest to Uranus administrative interface. DevTools is a comprehensive content management system that enables game architects and content creators to manage game content, configuration, and diagnostics without requiring database access or code deployments.

### Why DevTools Exists

DevTools serves as the primary operational control center for:
- **Content Management** - Managing prompts, events, items, NPCs, and other game content
- **System Configuration** - Runtime configuration changes for image models, settings, and feature flags
- **Content Versioning** - Publishing and activating reference releases for content iteration
- **System Observability** - Telemetry, metrics, logs, and cache statistics
- **Diagnostics** - Advanced debugging tools for turn processing, image generation, and LLM interactions

### Purpose Within the Larger System

When adding a new DevTool, you're extending the **Game Orchestrator Agent** (see [`AGENTS.md`](../AGENTS.md)) to provide new administrative capabilities. New DevTools integrate with:

- **Data Persistence Agent** - All DevTools operations interact with the storage layer (`server/storage.ts`)
- **Reference Steward Agent** - Content changes can be published as reference releases
- **Game Orchestrator Agent** - Admin endpoints route through `server/routes.ts`
- **Gateway & Security Agent** - All admin endpoints require authentication via `requireAdmin` middleware

### When to Add a New DevTool

Add a new DevTool tab when you need to:
1. **Manage a new content type** - New game content that requires CRUD operations (e.g., new entity types)
2. **Expose system configuration** - Runtime configuration that should be changeable without code deployments
3. **Provide diagnostics** - New observability or debugging capabilities
4. **Support content workflows** - Tools that facilitate content creation, testing, or publishing workflows

**Do NOT add a DevTool for:**
- One-off administrative tasks (use direct database access or scripts)
- Features that belong in the game client (player-facing features)
- Temporary debugging tools (use server logs or existing diagnostic tabs)

---

## Technical Details

### Components, Structure, and Architecture

#### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              New DevTool Tab Component                       │
│         (client/src/pages/devtools/YourNewTab.tsx)          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  React Component with:                                │   │
│  │  • React Query hooks (useQuery, useMutation)        │   │
│  │  • State management (useState)                        │   │
│  │  • UI components (shadcn/ui)                         │   │
│  │  • Toast notifications                               │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ HTTP (Authorization: Bearer <token>)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Admin API Endpoint                              │
│         (server/routes/yourResourceAdmin.ts)                 │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Express Router with:                                 │   │
│  │  • requireAdmin middleware                            │   │
│  │  • CRUD operations (GET, POST, PUT, DELETE)            │   │
│  │  • Zod validation                                     │   │
│  │  • Error handling                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Data Persistence Layer                           │
│              (server/storage.ts)                              │
│                                                               │
│  • Typed storage methods                                     │
│  • Transactional safety                                      │
│  • MariaDB  database operations                             │
└─────────────────────────────────────────────────────────────┘
```

#### Component Structure

**Client-Side Tab Component:**
- **Location:** `client/src/pages/devtools/YourNewTab.tsx`
- **Pattern:** Functional React component with hooks
- **Dependencies:**
  - `@tanstack/react-query` - Server state management
  - `@/lib/queryClient` - API request helpers (`apiRequest`, `queryClient`)
  - `@/hooks/use-toast` - Toast notifications
  - `@/components/ui/*` - shadcn/ui components
  - `./types` - TypeScript types (if shared with other tabs)

**Server-Side Admin Routes:**
- **Location:** `server/routes/yourResourceAdmin.ts`
- **Pattern:** Express Router with `requireAdmin` middleware
- **Dependencies:**
  - `express` - HTTP routing
  - `../middleware/adminAuth` - `requireAdmin` middleware
  - `../storage` - Database operations
  - `@shared/schema` - TypeScript types and Zod schemas

**Storage Layer Methods:**
- **Location:** `server/storage.ts`
- **Pattern:** Typed methods that interact with MariaDB
- **Responsibilities:**
  - CRUD operations for your resource
  - Transactional safety
  - Type-safe model translation (snake_case ↔ camelCase)

#### Technologies, Tools, and Frameworks

**Frontend Stack:**
- **React 18** - Component framework with hooks
- **TypeScript** - Type safety
- **React Query (TanStack Query)** - Server state management, caching, synchronization
- **shadcn/ui** - Component library (Tabs, Cards, Buttons, Forms, etc.)
- **Tailwind CSS** - Utility-first styling

**Backend Stack:**
- **Express.js** - HTTP server and routing
- **MariaDB** - Persistent storage
- **Zod** - Schema validation
- **TypeScript** - Type safety

**Authentication:**
- Admin token stored in `localStorage['uranus-admin-token']`
- Token injected as `Authorization: Bearer <token>` header via `apiRequest()`
- Server validates via `requireAdmin` middleware

#### Relationships and Interactions

**Client-Server Communication Flow:**

```
1. User Action (e.g., "Save Item")
   ↓
2. React Mutation Hook
   ↓
3. apiRequest("PUT", "/api/admin/items/:id", data)
   ↓
4. Express Router (requireAdmin middleware)
   ↓
5. Storage Layer (storage.updateItem())
   ↓
6. MariaDB Database
   ↓
7. Response → React Query Cache Invalidation
   ↓
8. UI Update + Toast Notification
```

**Inter-Tab Relationships:**
- Tabs can share types via `client/src/pages/devtools/types.ts`
- React Query cache invalidation can affect multiple tabs
- Reference releases capture state from all content tabs

#### Configurations and Parameters

**Admin Token Configuration:**
- **Storage Key:** `uranus-admin-token`
- **Validation:** Server-side via `requireAdmin` middleware
- **Scope:** Browser-specific (localStorage)

**API Request Configuration:**
- **Base URL:** Relative paths (e.g., `/api/admin/items`)
- **CSRF Protection:** Automatic via `apiRequest()` helper
- **Error Handling:** Automatic token clearing on 401, toast notifications

**React Query Defaults:**
- **Stale Time:** 0 (data considered stale immediately)
- **Cache Time:** 5 minutes
- **Retry:** 3 attempts with exponential backoff

---

## Practical Guidance

### Step-by-Step Instructions

#### Step 1: Define Your Data Model

**1.1. Add TypeScript Types to Shared Schema**

Edit `shared/schema.ts` to add your resource types:

```typescript
// Add to shared/schema.ts

export interface YourResource {
  id: string;
  name: string;
  description?: string;
  active: 0 | 1;
  // ... other fields
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertYourResource {
  name: string;
  description?: string;
  active?: 0 | 1;
  // ... other fields (exclude id, createdAt, updatedAt)
}
```

**1.2. Add Zod Schema for Validation**

```typescript
// Add to shared/schema.ts

import { z } from "zod";

export const insertYourResourceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  active: z.union([z.literal(0), z.literal(1)]).default(1),
  // ... other fields
});
```

**1.3. Add Database Table (if new resource type)**

Create a migration or add table definition to your database schema:

```sql
CREATE TABLE your_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(name)
);
```

#### Step 2: Implement Storage Layer Methods

**2.1. Add Storage Interface Methods**

Edit `server/storage.ts` to add methods to the `IStorage` interface:

```typescript
// Add to IStorage interface in server/storage.ts

export interface IStorage {
  // ... existing methods

  // Your resource methods
  getYourResources(): Promise<YourResource[]>;
  getActiveYourResources(): Promise<YourResource[]>;
  getYourResource(id: string): Promise<YourResource | undefined>;
  createYourResource(resource: InsertYourResource): Promise<YourResource>;
  updateYourResource(id: string, resource: Partial<InsertYourResource>): Promise<YourResource>;
  deleteYourResource(id: string): Promise<void>;
}
```

**2.2. Implement Storage Methods**

Add implementations to the `storage` object in `server/storage.ts`:

```typescript
// Add to storage object in server/storage.ts

async getYourResources(): Promise<YourResource[]> {
  const startTime = Date.now();
  try {
    const result = await pool.query<YourResourceRow>(
      "SELECT * FROM your_resources ORDER BY name ASC"
    );
    dbOperationDuration.observe({ operation: "get_your_resources" }, Date.now() - startTime);
    return result.rows.map(rowToYourResource);
  } catch (error) {
    dbOperationDuration.observe({ operation: "get_your_resources", error: true }, Date.now() - startTime);
    throw error;
  }
},

async getActiveYourResources(): Promise<YourResource[]> {
  const startTime = Date.now();
  try {
    const result = await pool.query<YourResourceRow>(
      "SELECT * FROM your_resources WHERE active = 1 ORDER BY name ASC"
    );
    dbOperationDuration.observe({ operation: "get_active_your_resources" }, Date.now() - startTime);
    return result.rows.map(rowToYourResource);
  } catch (error) {
    dbOperationDuration.observe({ operation: "get_active_your_resources", error: true }, Date.now() - startTime);
    throw error;
  }
},

async getYourResource(id: string): Promise<YourResource | undefined> {
  const startTime = Date.now();
  try {
    const result = await pool.query<YourResourceRow>(
      "SELECT * FROM your_resources WHERE id = $1",
      [id]
    );
    dbOperationDuration.observe({ operation: "get_your_resource" }, Date.now() - startTime);
    return result.rows[0] ? rowToYourResource(result.rows[0]) : undefined;
  } catch (error) {
    dbOperationDuration.observe({ operation: "get_your_resource", error: true }, Date.now() - startTime);
    throw error;
  }
},

async createYourResource(resource: InsertYourResource): Promise<YourResource> {
  const startTime = Date.now();
  try {
    const validated = insertYourResourceSchema.parse(resource);
    const id = randomUUID();
    const result = await pool.query<YourResourceRow>(
      `INSERT INTO your_resources (id, name, description, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [id, validated.name, validated.description ?? null, validated.active ?? 1]
    );
    dbOperationDuration.observe({ operation: "create_your_resource" }, Date.now() - startTime);
    return rowToYourResource(result.rows[0]);
  } catch (error) {
    dbOperationDuration.observe({ operation: "create_your_resource", error: true }, Date.now() - startTime);
    throw error;
  }
},

async updateYourResource(id: string, resource: Partial<InsertYourResource>): Promise<YourResource> {
  const startTime = Date.now();
  try {
    const validated = insertYourResourceSchema.partial().parse(resource);
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (validated.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(validated.name);
    }
    if (validated.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(validated.description);
    }
    if (validated.active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(validated.active);
    }

    if (updates.length === 0) {
      return await this.getYourResource(id) as YourResource;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query<YourResourceRow>(
      `UPDATE your_resources SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    dbOperationDuration.observe({ operation: "update_your_resource" }, Date.now() - startTime);
    return rowToYourResource(result.rows[0]);
  } catch (error) {
    dbOperationDuration.observe({ operation: "update_your_resource", error: true }, Date.now() - startTime);
    throw error;
  }
},

async deleteYourResource(id: string): Promise<void> {
  const startTime = Date.now();
  try {
    await pool.query("DELETE FROM your_resources WHERE id = $1", [id]);
    dbOperationDuration.observe({ operation: "delete_your_resource" }, Date.now() - startTime);
  } catch (error) {
    dbOperationDuration.observe({ operation: "delete_your_resource", error: true }, Date.now() - startTime);
    throw error;
  }
},
```

**2.3. Add Row-to-Model Conversion Helper**

```typescript
// Add helper function in server/storage.ts

interface YourResourceRow {
  id: string;
  name: string;
  description: string | null;
  active: number;
  created_at: Date;
  updated_at: Date;
}

function rowToYourResource(row: YourResourceRow): YourResource {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    active: row.active as 0 | 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

#### Step 3: Create Admin API Endpoints

**3.1. Create Admin Router File**

Create `server/routes/yourResourceAdmin.ts`:

```typescript
import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";
import { insertYourResourceSchema } from "@shared/schema";

export const yourResourceAdmin = express.Router();

// Apply requireAdmin middleware to all routes
yourResourceAdmin.use(requireAdmin);

// GET /api/admin/your-resources - List all resources
yourResourceAdmin.get("/", async (_req, res) => {
  try {
    const resources = await storage.getYourResources();
    res.json(resources);
  } catch (error) {
    console.error("Error fetching your resources:", error);
    res.status(500).json({ error: "Failed to fetch resources" });
  }
});

// POST /api/admin/your-resources - Create new resource
yourResourceAdmin.post("/", async (req, res) => {
  try {
    const validated = insertYourResourceSchema.parse(req.body);
    const newResource = await storage.createYourResource(validated);
    res.status(201).json(newResource);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error creating resource:", error);
    res.status(500).json({ error: "Failed to create resource" });
  }
});

// PUT /api/admin/your-resources/:id - Update resource
yourResourceAdmin.put("/:id", async (req, res) => {
  try {
    const validated = insertYourResourceSchema.partial().parse(req.body);
    const updated = await storage.updateYourResource(req.params.id, validated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error updating resource:", error);
    res.status(500).json({ error: "Failed to update resource" });
  }
});

// DELETE /api/admin/your-resources/:id - Delete resource
yourResourceAdmin.delete("/:id", async (req, res) => {
  try {
    await storage.deleteYourResource(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting resource:", error);
    res.status(500).json({ error: "Failed to delete resource" });
  }
});
```

**3.2. Register Admin Router**

Edit `server/index.ts` to register your admin router:

```typescript
// Add to server/index.ts in the async IIFE around line 242

{
  const { yourResourceAdmin } = await import("./routes/yourResourceAdmin.ts");
  app.use("/api/admin/your-resources", yourResourceAdmin);
}
```

#### Step 4: Create Client-Side Tab Component

**4.1. Create Tab Component File**

Create `client/src/pages/devtools/YourResourceTab.tsx`:

```typescript
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

import { YourResource } from "./types";

const defaultResourceForm = {
  name: "",
  description: "",
  active: 1 as 0 | 1,
};

export function YourResourceTab() {
  const { toast } = useToast();
  const { data: resources, isLoading: resourcesLoading } = useQuery<YourResource[]>({
    queryKey: ["/api/admin/your-resources"],
  });

  const [selectedResource, setSelectedResource] = useState<YourResource | null>(null);
  const [isCreatingResource, setIsCreatingResource] = useState(false);
  const [resourceForm, setResourceForm] = useState({ ...defaultResourceForm });

  const createResourceMutation = useMutation({
    mutationFn: async (resourceData: typeof defaultResourceForm) => {
      const res = await apiRequest("POST", "/api/admin/your-resources", resourceData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/your-resources"] });
      setIsCreatingResource(false);
      setResourceForm({ ...defaultResourceForm });
      toast({
        title: "Resource Created",
        description: "The resource has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Creation Failed",
        description: "Failed to create the resource.",
        variant: "destructive",
      });
    },
  });

  const updateResourceMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<typeof defaultResourceForm>) => {
      const res = await apiRequest("PUT", `/api/admin/your-resources/${id}`, updates);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/your-resources"] });
      toast({
        title: "Resource Updated",
        description: "The resource has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update the resource.",
        variant: "destructive",
      });
    },
  });

  const handleSelectResource = (resource: YourResource) => {
    setSelectedResource(resource);
    setIsCreatingResource(false);
    setResourceForm({
      name: resource.name,
      description: resource.description || "",
      active: resource.active,
    });
  };

  const handleCreateNewResource = () => {
    setSelectedResource(null);
    setIsCreatingResource(true);
    setResourceForm({ ...defaultResourceForm });
  };

  const handleSaveResource = () => {
    if (isCreatingResource) {
      createResourceMutation.mutate(resourceForm);
    } else if (selectedResource) {
      updateResourceMutation.mutate({
        id: selectedResource.id,
        ...resourceForm,
      });
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Left: List Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Resources</CardTitle>
              <CardDescription>Manage your resources</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCreateNewResource}>
              <Plus className="h-4 w-4 mr-2" />
              New Resource
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {resourcesLoading ? (
              <p className="text-muted-foreground">Loading resources...</p>
            ) : (
              <div className="space-y-2">
                {resources?.map((resource) => (
                  <Button
                    key={resource.id}
                    variant={selectedResource?.id === resource.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => handleSelectResource(resource)}
                  >
                    <div className="flex flex-col items-start w-full">
                      <div className="font-semibold">{resource.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {resource.active ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Right: Editor Panel */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isCreatingResource
              ? "Create New Resource"
              : selectedResource
              ? `Edit: ${selectedResource.name}`
              : "Select a resource"}
          </CardTitle>
          <CardDescription>
            {isCreatingResource || selectedResource
              ? "Configure resource parameters"
              : "Choose a resource from the list to edit"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCreatingResource || selectedResource ? (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label htmlFor="resource-name">Name</Label>
                  <Input
                    id="resource-name"
                    value={resourceForm.name}
                    onChange={(event) => setResourceForm({ ...resourceForm, name: event.target.value })}
                    placeholder="e.g., My Resource"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="resource-description">Description</Label>
                  <Textarea
                    id="resource-description"
                    value={resourceForm.description}
                    onChange={(event) =>
                      setResourceForm({ ...resourceForm, description: event.target.value })
                    }
                    placeholder="Describe the resource"
                    className="min-h-[120px]"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="resource-active"
                    checked={resourceForm.active === 1}
                    onCheckedChange={(checked) =>
                      setResourceForm({ ...resourceForm, active: checked ? 1 : 0 })
                    }
                  />
                  <Label htmlFor="resource-active">Active</Label>
                </div>

                <Button
                  onClick={handleSaveResource}
                  disabled={createResourceMutation.isPending || updateResourceMutation.isPending}
                  className="w-full"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {createResourceMutation.isPending || updateResourceMutation.isPending
                    ? "Saving..."
                    : isCreatingResource
                    ? "Create Resource"
                    : "Save Changes"}
                </Button>
              </div>
            </ScrollArea>
          ) : (
            <div className="h-[600px] flex items-center justify-center text-muted-foreground">
              Select a resource to edit or create a new one
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**4.2. Add Type to Types File (if needed)**

If your resource type isn't already in `shared/schema.ts`, add it to `client/src/pages/devtools/types.ts`:

```typescript
// Add to client/src/pages/devtools/types.ts (if not using shared types)

export interface YourResource {
  id: string;
  name: string;
  description?: string;
  active: 0 | 1;
  createdAt: Date;
  updatedAt: Date;
}
```

**4.3. Register Tab in DevToolsPage**

Edit `client/src/pages/DevToolsPage.tsx`:

```typescript
// Add import at top
import { YourResourceTab } from "@/pages/devtools/YourResourceTab";

// Add tab trigger in TabsList (around line 150)
<TabsTrigger value="your-resources">Your Resources</TabsTrigger>

// Add tab content (around line 240)
<TabsContent value="your-resources" className="space-y-4">
  <YourResourceTab />
</TabsContent>
```

#### Step 5: Add Reference Endpoint (Optional)

If your resource should be included in reference releases, create a reference endpoint:

**5.1. Create Reference Router**

Create `server/routes/yourResourceReference.ts`:

```typescript
import express from "express";
import { getCurrentReference } from "../reference/referenceLoader";

export const yourResourceReference = express.Router();

// GET /api/reference/your-resources - Get active resources from current release
yourResourceReference.get("/", async (_req, res) => {
  try {
    const reference = await getCurrentReference();
    const resources = reference.data.yourResources || [];
    res.json(resources.filter((r) => r.active === 1));
  } catch (error) {
    console.error("Error fetching reference resources:", error);
    res.status(500).json({ error: "Failed to fetch resources" });
  }
});
```

**5.2. Register Reference Router**

Edit `server/index.ts`:

```typescript
{
  const { yourResourceReference } = await import("./routes/yourResourceReference.ts");
  app.use("/api/reference/your-resources", yourResourceReference);
}
```

**5.3. Update Reference Publishing**

Edit `server/reference/publishReference.ts` to include your resource in published releases:

```typescript
// In publishReference function, add:
const yourResources = await storage.getYourResources();
// ... add to data object
data.yourResources = yourResources;
```

### Code Examples and Usage Patterns

#### Common Tab Component Pattern

Most content management tabs follow this pattern:

```typescript
export function ExampleTab() {
  const { toast } = useToast();
  
  // 1. Fetch data with React Query
  const { data: items, isLoading } = useQuery<Item[]>({
    queryKey: ["/api/admin/items"],
  });

  // 2. Local state for selection and form
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(defaultForm);

  // 3. Create mutation
  const createMutation = useMutation({
    mutationFn: async (payload: FormData) => {
      return await apiRequest("POST", "/api/admin/items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      setIsCreating(false);
      setForm(defaultForm);
      toast({ title: "Item created" });
    },
  });

  // 4. Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<FormData>) => {
      return await apiRequest("PUT", `/api/admin/items/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      toast({ title: "Item updated" });
    },
  });

  // 5. Two-column layout: list + editor
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* List panel */}
      <Card>...</Card>
      {/* Editor panel */}
      <Card>...</Card>
    </div>
  );
}
```

#### API Request Pattern

All DevTools tabs use the `apiRequest` helper:

```typescript
import { apiRequest, queryClient } from "@/lib/queryClient";

// GET request
const { data } = useQuery({
  queryKey: ["/api/admin/items"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/admin/items");
    return await res.json();
  },
});

// POST request (create)
const createMutation = useMutation({
  mutationFn: async (payload: unknown) => {
    const res = await apiRequest("POST", "/api/admin/items", payload);
    return await res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
  },
});

// PUT request (update)
const updateMutation = useMutation({
  mutationFn: async ({ id, ...updates }: { id: string } & Partial<Item>) => {
    const res = await apiRequest("PUT", `/api/admin/items/${id}`, updates);
    return await res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
  },
});
```

#### Admin Router Pattern

All admin routers follow this pattern:

```typescript
import express from "express";
import { requireAdmin } from "../middleware/adminAuth";
import { storage } from "../storage";
import { insertResourceSchema } from "@shared/schema";
import { z } from "zod";

export const resourceAdmin = express.Router();

// Apply requireAdmin to all routes
resourceAdmin.use(requireAdmin);

// GET - List all
resourceAdmin.get("/", async (_req, res) => {
  try {
    const resources = await storage.getResources();
    res.json(resources);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch resources" });
  }
});

// POST - Create
resourceAdmin.post("/", async (req, res) => {
  try {
    const validated = insertResourceSchema.parse(req.body);
    const newResource = await storage.createResource(validated);
    res.status(201).json(newResource);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to create resource" });
  }
});

// PUT - Update
resourceAdmin.put("/:id", async (req, res) => {
  try {
    const validated = insertResourceSchema.partial().parse(req.body);
    const updated = await storage.updateResource(req.params.id, validated);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
  }
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to update resource" });
  }
});
```

### Best Practices and Guidelines

#### Content Management Tabs

1. **Use Two-Column Layout:**
   - Left: List of items with metadata
   - Right: Editor form for selected item or new item creation

2. **Active/Inactive Pattern:**
   - Use `active: 0 | 1` field for soft deletion
   - Don't hard-delete content unless absolutely necessary
   - Preserves history and allows rollback

3. **Form Validation:**
   - Client-side validation before API call
   - Server-side validation via Zod schemas
   - Show validation errors in toast notifications

4. **React Query Cache Invalidation:**
   - Always invalidate queries after mutations
   - Use consistent query keys
   - Invalidate related queries if needed

#### API Design

1. **Consistent Endpoint Naming:**
   - Admin endpoints: `/api/admin/resource-name`
   - Reference endpoints: `/api/reference/resource-name`
   - Use kebab-case for multi-word resources

2. **HTTP Methods:**
   - `GET` - List or retrieve
   - `POST` - Create (returns 201)
   - `PUT` - Update (returns 200)
   - `DELETE` - Delete (returns 204)

3. **Error Responses:**
   - 400: Validation error (include Zod error details)
   - 401: Authentication required
   - 404: Resource not found
   - 500: Server error

4. **Response Format:**
   - Success: Return resource object(s)
   - Error: `{ error: string, details?: unknown }`

#### Storage Layer

1. **Type Safety:**
   - Use TypeScript interfaces for all models
   - Convert between snake_case (DB) and camelCase (TypeScript)
   - Use Zod schemas for validation

2. **Error Handling:**
   - Log errors with context
   - Record metrics for database operations
   - Throw errors for callers to handle

3. **Transaction Safety:**
   - Use `processTurnWithTransaction` for game state updates
   - Use transactions for multi-step operations
   - Handle unique constraint violations gracefully

#### UI/UX

1. **Loading States:**
   - Show loading indicators during API calls
   - Disable buttons during mutations
   - Display "Saving..." or "Loading..." text

2. **Error Handling:**
   - Show toast notifications for errors
   - Include actionable error messages
   - Don't leave UI in inconsistent state

3. **Success Feedback:**
   - Toast notifications for successful operations
   - Immediate UI updates (via React Query invalidation)
   - Clear visual feedback (button states, highlights)

---

## Troubleshooting & Support

### Common Issues and Their Solutions

#### Issue: Tab Not Appearing in DevTools

**Symptoms:** Tab doesn't show up in DevTools interface

**Causes:**
1. Tab not registered in `DevToolsPage.tsx`
2. Import path incorrect
3. Component export issue

**Solutions:**
1. Verify tab is imported: `import { YourTab } from "@/pages/devtools/YourTab";`
2. Verify tab trigger exists: `<TabsTrigger value="your-tab">Your Tab</TabsTrigger>`
3. Verify tab content exists: `<TabsContent value="your-tab"><YourTab /></TabsContent>`
4. Check browser console for import errors

#### Issue: 401 Unauthorized Errors

**Symptoms:** All API requests return 401

**Causes:**
1. Admin token not set
2. Token invalid or expired
3. `requireAdmin` middleware not applied

**Solutions:**
1. Check admin token in localStorage: `localStorage.getItem('uranus-admin-token')`
2. Verify token is correct (check server logs)
3. Ensure `requireAdmin` middleware is applied to router: `router.use(requireAdmin)`
4. Check token is injected in requests (browser Network tab)

#### Issue: Data Not Loading

**Symptoms:** Tab shows "Loading..." indefinitely or empty list

**Causes:**
1. API endpoint not registered
2. Storage method not implemented
3. Database table doesn't exist
4. Query key mismatch

**Solutions:**
1. Verify endpoint is registered in `server/index.ts`
2. Check storage method exists and is implemented
3. Verify database table exists
4. Check query key matches endpoint: `queryKey: ["/api/admin/your-resources"]`
5. Check browser Network tab for API errors
6. Check server logs for errors

#### Issue: Save/Update Not Working

**Symptoms:** Clicking save doesn't update data

**Causes:**
1. Validation error (Zod schema)
2. Database constraint violation
3. Mutation not triggering
4. Cache not invalidating

**Solutions:**
1. Check browser console for validation errors
2. Check server logs for database errors
3. Verify mutation is called: `mutation.mutate(data)`
4. Verify cache invalidation: `queryClient.invalidateQueries({ queryKey: [...] })`
5. Check Network tab for API response

#### Issue: Type Errors

**Symptoms:** TypeScript compilation errors

**Causes:**
1. Types not defined in `shared/schema.ts`
2. Type mismatch between client and server
3. Missing type imports

**Solutions:**
1. Add types to `shared/schema.ts`
2. Ensure types match between client and server
3. Import types: `import { YourResource } from "@shared/schema"`
4. Check type definitions match database schema

### Error Messages and Their Meanings

#### Client-Side Errors

**"Token is required"**
- **Meaning:** Admin token input is empty
- **Action:** Enter valid admin token

**"Failed to create/update resource"**
- **Meaning:** API request failed
- **Action:** Check browser console and Network tab for details

**"Missing required fields"**
- **Meaning:** Form validation failed
- **Action:** Fill in all required fields (marked with *)

#### Server-Side Errors

**401 Unauthorized**
- **Meaning:** Admin token invalid or missing
- **Action:** Re-authenticate with valid token

**400 Bad Request**
- **Meaning:** Request validation failed
- **Action:** Check request payload, verify JSON syntax, ensure all required fields present

**404 Not Found**
- **Meaning:** Resource doesn't exist
- **Action:** Verify resource ID, check if resource was deleted

**500 Internal Server Error**
- **Meaning:** Server-side error (database, filesystem, etc.)
- **Action:** Check server logs, verify database connectivity

### Debugging Tips and Strategies

#### Browser DevTools

1. **Network Tab:**
   - Monitor all API requests
   - Check request headers (Authorization token present?)
   - Review response status codes and bodies
   - Verify request payloads

2. **Console Tab:**
   - Check for JavaScript errors
   - Look for React Query errors
   - Verify CustomEvent broadcasts (token sync)

3. **Application Tab:**
   - Check localStorage for admin token
   - Verify token value
   - Clear storage if needed for testing

#### React Query DevTools

Enable React Query DevTools for cache inspection:

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

<ReactQueryDevtools initialIsOpen={false} />
```

Use to:
- Inspect query cache state
- See active queries and their data
- Manually invalidate queries
- Check query status (loading, error, success)

#### Server Logs

Check server logs for:
- Authentication failures
- Database errors
- Validation errors
- API endpoint registration

**Log Locations:**
- Console output (development)
- `logs/app-*.log` (file-based logging)
- `logs/error-*.log` (error-specific)

#### Systematic Debugging Approach

1. **Reproduce Issue:**
   - Note exact steps to reproduce
   - Check if issue is consistent or intermittent
   - Verify issue occurs in specific context

2. **Isolate Scope:**
   - Does issue affect one tab or all tabs?
   - Does issue affect one operation or all operations?
   - Does issue occur for one user or all users?

3. **Check Dependencies:**
   - Verify admin token is valid
   - Check database connectivity
   - Verify filesystem permissions
   - Check external API availability

4. **Review Recent Changes:**
   - Check git history for recent changes
   - Review reference release publish history
   - Check if issue started after specific change

5. **Use Diagnostic Tools:**
   - Browser DevTools (Network, Console)
   - React Query DevTools
   - Server logs
   - Database queries (if needed)

---

## Standards & Processes

### Quality Requirements and Criteria

#### Code Quality

1. **TypeScript Strict Mode:**
   - All code must be type-safe
   - No `any` types (use `unknown` if needed)
   - Types must round-trip cleanly across client/server

2. **Component Structure:**
   - Functional React components with hooks
   - Clear separation of concerns
   - Reusable logic extracted to custom hooks

3. **Error Handling:**
   - All errors must be handled gracefully
   - User-friendly error messages
   - Server errors logged with context

#### API Standards

1. **Validation:**
   - All inputs validated via Zod schemas
   - Type checking on client and server
   - Sanitization for XSS prevention

2. **Response Format:**
   - Consistent response structure
   - Proper HTTP status codes
   - Error responses include details

3. **Documentation:**
   - Endpoints documented in `API_GUIDE.md`
   - Types documented in code
   - Examples provided in documentation

#### Testing Requirements

1. **Manual Testing:**
   - Test all CRUD operations
   - Test error scenarios
   - Test with invalid data
   - Test with missing authentication

2. **Integration Testing:**
   - Test API endpoints with valid/invalid tokens
   - Test storage layer methods
   - Test error handling paths

3. **E2E Testing:**
   - Test full workflow
   - Test cross-tab interactions
   - Test authentication flow

### Security Considerations

#### Authentication

1. **Admin Token Security:**
   - Tokens stored in localStorage (browser-specific)
   - Tokens transmitted via `Authorization: Bearer` header
   - Tokens validated server-side on every request
   - No token expiration (manual rotation required)

2. **Token Best Practices:**
   - Use strong, random tokens
   - Rotate tokens periodically
   - Don't commit tokens to version control
   - Use different tokens for different environments

#### Authorization

1. **Admin-Only Endpoints:**
   - All `/api/admin/*` endpoints require admin token
   - `requireAdmin` middleware validates token
   - Returns 401 if token missing or invalid

2. **CSRF Protection:**
   - All state-changing requests include CSRF token
   - CSRF token obtained via `/api/csrf-token`
   - `apiRequest` helper handles CSRF automatically

#### Data Validation

1. **Input Validation:**
   - All inputs validated via Zod schemas
   - Type checking on client and server
   - Sanitization for XSS prevention (handled by framework)

2. **Output Sanitization:**
   - React automatically escapes content
   - No raw HTML rendering (unless explicitly marked safe)
   - JSON responses properly serialized

#### Rate Limiting

1. **Admin Endpoints:**
   - Subject to global rate limiting
   - Higher limits than public endpoints
   - Still protected against abuse

2. **Best Practices:**
   - Batch operations when possible
   - Use reference releases for bulk changes
   - Avoid rapid-fire API calls in loops

### Performance Implications

#### React Query Caching

1. **Cache Strategy:**
   - Data cached for 5 minutes by default
   - Stale data refetched on window focus
   - Manual invalidation after mutations

2. **Optimization Tips:**
   - Use `queryKey` consistently for cache hits
   - Invalidate only necessary queries (not all)
   - Consider `staleTime` for rarely-changing data

#### API Request Optimization

1. **Batching:**
   - Load related data in parallel queries
   - Use React Query's `useQueries` for multiple requests
   - Avoid sequential API calls when possible

2. **Pagination:**
   - Use pagination for large datasets
   - Don't load all data if not needed
   - Consider virtual scrolling for very large lists

#### Database Performance

1. **Query Optimization:**
   - Use indexes on frequently queried columns
   - Avoid N+1 queries
   - Use transactions for multi-step operations

2. **Caching:**
   - Reference releases use filesystem (faster reads)
   - In-memory caching of reference data
   - Cache invalidation on release activation

### Testing and Validation Approaches

#### Manual Testing Checklist

**Content Management:**
- [ ] Create new resource
- [ ] Edit existing resource
- [ ] Archive resource (set inactive)
- [ ] Verify changes persist after refresh
- [ ] Verify changes visible in other tabs

**API Endpoints:**
- [ ] Test GET endpoint (list all)
- [ ] Test GET endpoint (get one)
- [ ] Test POST endpoint (create)
- [ ] Test PUT endpoint (update)
- [ ] Test DELETE endpoint (delete)
- [ ] Test with invalid token (401)
- [ ] Test with missing token (401)
- [ ] Test with invalid data (400)

**Error Handling:**
- [ ] Test validation errors
- [ ] Test database errors
- [ ] Test network errors
- [ ] Verify error messages are user-friendly

#### Automated Testing

**Unit Tests:**
- Test storage layer methods
- Test validation logic
- Test error handling

**Integration Tests:**
- Test API endpoints with valid/invalid tokens
- Test storage layer with database
- Test error handling paths

**E2E Tests:**
- Test full workflow
- Test authentication flow
- Test cross-tab interactions

#### Validation Strategies

1. **Content Validation:**
   - Validate JSON syntax before saving
   - Check required fields client-side
   - Verify server-side validation matches client
   - Test edge cases (empty strings, special characters)

2. **API Validation:**
   - Test with valid data
   - Test with invalid data
   - Test with missing data
   - Test with malformed data

3. **Type Validation:**
   - Ensure types match between client and server
   - Test type coercion
   - Test type errors

---

## Visual Aids

### Architecture Diagram: Adding a New DevTool

```
┌─────────────────────────────────────────────────────────────┐
│                    Step 1: Define Types                      │
│              (shared/schema.ts)                              │
│                                                               │
│  • TypeScript interfaces                                     │
│  • Zod schemas for validation                               │
│  • Database table definition                                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Step 2: Storage Layer                     │
│              (server/storage.ts)                             │
│                                                               │
│  • Add methods to IStorage interface                         │
│  • Implement database operations                             │
│  • Add row-to-model conversion                               │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Step 3: Admin API                         │
│         (server/routes/yourResourceAdmin.ts)                │
│                                                               │
│  • Create Express router                                    │
│  • Apply requireAdmin middleware                            │
│  • Implement CRUD endpoints                                 │
│  • Register router in server/index.ts                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Step 4: Client Component                  │
│      (client/src/pages/devtools/YourResourceTab.tsx)        │
│                                                               │
│  • Create React component                                   │
│  • Add React Query hooks                                    │
│  • Implement UI with shadcn/ui                              │
│  • Register tab in DevToolsPage.tsx                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Step 5: Reference Endpoint (Optional)      │
│      (server/routes/yourResourceReference.ts)               │
│                                                               │
│  • Create reference router                                  │
│  • Load from reference releases                            │
│  • Update publishReference.ts                               │
└─────────────────────────────────────────────────────────────┘
```

### Component Structure Diagram

```
DevToolsPage.tsx
│
├── Authentication Layer
│   ├── Token input form
│   └── Token validation
│
└── Tab Navigation
    │
    ├── Your New Tab
    │   ├── List Panel (Left)
    │   │   ├── Resource list
    │   │   ├── Selection state
    │   │   └── "New" button
    │   │
    │   └── Editor Panel (Right)
    │       ├── Form fields
    │       ├── Save button
    │       └── Active checkbox
    │
    └── Other Tabs...
```

### Data Flow Diagram

```
User Action
    │
    ▼
React Component
    │
    ├── useMutation
    │   │
    │   └── apiRequest()
    │       │
    │       ├── Inject admin token
    │       ├── Add CSRF token
    │       └── HTTP request
    │           │
    │           ▼
    │       Express Router
    │           │
    │           ├── requireAdmin middleware
    │           │   └── Validate token
    │           │
    │           └── Route handler
    │               │
    │               ├── Zod validation
    │               └── Storage method
    │                   │
    │                   ▼
    │               MariaDB  Database
    │                   │
    │                   ▼
    │               Response
    │                   │
    │                   ▼
    │               React Query Cache
    │                   │
    │                   ├── Invalidate queries
    │                   └── Update UI
    │                       │
    │                       └── Toast notification
```

---

## Cross-References

### Related Documentation

**System Architecture:**
- [`AGENTS.md`](../AGENTS.md) - Agent responsibilities and interactions
- [`docs_master/current/SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) - High-level system architecture
- [`docs_master/current/API_GUIDE.md`](API_GUIDE.md) - Complete API documentation

**DevTools Documentation:**
- [`docs_master/current/DEVTOOLS_COMPREHENSIVE.md`](DEVTOOLS_COMPREHENSIVE.md) - Complete DevTools documentation
- [`docs_master/current/DEVTOOLS_PCE_AUDIT.md`](DEVTOOLS_PCE_AUDIT.md) - Historical audit (deprecated tools)

**Content Management:**
- [`docs_master/current/REFERENCE_RELEASE_PUBLISHING.md`](REFERENCE_RELEASE_PUBLISHING.md) - Reference release system
- [`docs_master/current/PROMPT_COMPOSITION_ENGINE.md`](PROMPT_COMPOSITION_ENGINE.md) - PCE architecture

**Client Architecture:**
- [`docs_master/current/CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md`](CLIENT_FUNCTIONAL_DOCUMENTATION_V4.md) - Client-side patterns

### Key Files and Modules

**Client-Side:**
- `client/src/pages/DevToolsPage.tsx` - Main DevTools page
- `client/src/pages/devtools/*.tsx` - Tab components
- `client/src/pages/devtools/types.ts` - Shared types
- `client/src/lib/queryClient.ts` - API helpers
- `client/src/hooks/use-toast.ts` - Toast notifications

**Server-Side:**
- `server/routes.ts` - Main route registration
- `server/routes/*Admin.ts` - Admin endpoint routers
- `server/routes/*Reference.ts` - Reference endpoint routers
- `server/middleware/adminAuth.ts` - Admin authentication
- `server/storage.ts` - Database operations
- `server/reference/publishReference.ts` - Reference publishing

**Shared:**
- `shared/schema.ts` - TypeScript types and Zod schemas

### Example Implementations

**Content Management Tabs:**
- `client/src/pages/devtools/EventsTab.tsx` - Full CRUD example
- `client/src/pages/devtools/ItemsTab.tsx` - Another CRUD example
- `client/src/pages/devtools/SettingsTab.tsx` - Different pattern (key-value)

**Admin Routers:**
- `server/routes/itemsAdmin.ts` - Simple CRUD router
- `server/routes/eventsAdmin.ts` - Another CRUD router

**Storage Methods:**
- `server/storage.ts` - See `getItems()`, `createItem()`, `updateItem()` methods

### API Endpoint Patterns

**Admin Endpoints:**
- `GET /api/admin/resource` - List all
- `POST /api/admin/resource` - Create
- `PUT /api/admin/resource/:id` - Update
- `DELETE /api/admin/resource/:id` - Delete

**Reference Endpoints:**
- `GET /api/reference/resource` - Get active from current release

### Dependencies

**External Libraries:**
- `@tanstack/react-query` - Server state management
- `shadcn/ui` - UI component library
- `lucide-react` - Icon library
- `wouter` - Routing
- `zod` - Schema validation
- `express` - HTTP server
- `mariadb` - Database driver

**Internal Dependencies:**
- `@/lib/queryClient` - API helpers
- `@/hooks/use-toast` - Toast notifications
- `@/components/ui/*` - shadcn/ui components
- `@shared/schema` - Shared types
- `../middleware/adminAuth` - Admin authentication
- `../storage` - Database operations

---

_End of Engineering and Architecture Guide: Adding New DevTools_

