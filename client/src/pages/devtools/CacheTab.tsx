import { Image as ImageIcon } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function CacheTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Image Cache Management</CardTitle>
        <CardDescription>Manage cached generated images and view cache analytics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Access the full cache management interface to view, manage, and analyze your cached images.
          </p>
          <Link to="/dev-tools/cache">
            <Button>
              <ImageIcon className="h-4 w-4 mr-2" />
              Open Cache Manager
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
