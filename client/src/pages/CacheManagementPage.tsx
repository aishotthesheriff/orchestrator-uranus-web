import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { 
  ArrowLeft, 
  RefreshCw, 
  Trash2, 
  Search, 
  Filter, 
  Download, 
  Eye,
  BarChart3,
  Settings,
  Image as ImageIcon,
  HardDrive,
  Clock,
  TrendingUp
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface GeneratedImage {
  id: string;
  templateName: string;
  promptHash: string;
  variablesHash: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  sceneFingerprint: any;
  metadata: any;
  gameId: string | null;
  turnNumber: number | null;
  createdAt: string;
  accessedAt: string;
  accessCount: number;
}

interface CacheStats {
  totalImages: number;
  totalSize: number;
  hitRate: number;
  averageGenerationTime: number;
}

export default function CacheManagementPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [showImageModal, setShowImageModal] = useState<GeneratedImage | null>(null);

  // Fetch cache statistics
  const { data: stats, refetch: refetchStats } = useQuery<CacheStats>({
    queryKey: ['api', 'cache', 'stats'],
  });

  // Fetch cached images
  const { data: images, refetch: refetchImages, isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ['api', 'cache', 'images', templateFilter !== 'all' ? { templateName: templateFilter } : {}],
  });

  // Get unique template names for filter
  const templateNames = images ? Array.from(new Set(images.map(img => img.templateName))) : [];

  // Filter images based on search term
  const filteredImages = images?.filter(img => 
    img.templateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    img.metadata?.promptUsed?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Clear cache mutation
  const clearCacheMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/cache/clear'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api', 'cache', 'images'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'cache', 'stats'] });
      setSelectedImages(new Set());
      toast({
        title: "Cache Cleared",
        description: "All cached images have been deleted.",
      });
    },
  });

  // Delete selected images mutation
  const deleteSelectedMutation = useMutation({
    mutationFn: (imageIds: string[]) => 
      Promise.all(imageIds.map(id => 
        apiRequest('DELETE', `/api/cache/images/${id}`)
      )),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api', 'cache', 'images'] });
      queryClient.invalidateQueries({ queryKey: ['api', 'cache', 'stats'] });
      setSelectedImages(new Set());
      toast({
        title: "Images Deleted",
        description: "Selected images have been deleted.",
      });
    },
  });

  const handleSelectImage = (imageId: string, selected: boolean) => {
    const newSelected = new Set(selectedImages);
    if (selected) {
      newSelected.add(imageId);
    } else {
      newSelected.delete(imageId);
    }
    setSelectedImages(newSelected);
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedImages(new Set(filteredImages.map(img => img.id)));
    } else {
      setSelectedImages(new Set());
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link to="/dev-tools">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dev Tools
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Image Cache Management</h1>
            <p className="text-muted-foreground">Manage generated image cache and analytics</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { refetchStats(); refetchImages(); }} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Cache
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear Entire Cache</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all cached images and cannot be undone. 
                  Are you sure you want to continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearCacheMutation.mutate()}>
                  Clear Cache
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Images</CardTitle>
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalImages || 0}</div>
                <p className="text-xs text-muted-foreground">Cached images</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatFileSize(stats?.totalSize || 0)}</div>
                <p className="text-xs text-muted-foreground">Disk space</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{((stats?.hitRate || 0) * 100).toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Performance</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Generation</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{Math.round(stats?.averageGenerationTime || 0)}ms</div>
                <p className="text-xs text-muted-foreground">Response time</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest cached images</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {images?.slice(0, 10).map((image) => (
                    <div key={image.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="font-medium">{image.templateName}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDate(image.createdAt)} • {formatFileSize(image.fileSize)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{image.accessCount} accesses</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowImageModal(image)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Images Tab */}
        <TabsContent value="images" className="space-y-6">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label htmlFor="search">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search"
                      placeholder="Search by template or prompt..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="w-48">
                  <Label htmlFor="template">Template</Label>
                  <Select value={templateFilter} onValueChange={setTemplateFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All templates" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All templates</SelectItem>
                      {templateNames.map(name => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Image Grid */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Cached Images ({filteredImages.length})</CardTitle>
                  <CardDescription>Manage your cached image collection</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedImages.size === filteredImages.length && filteredImages.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                  <Label>Select All</Label>
                  {selectedImages.size > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Selected ({selectedImages.size})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Selected Images</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete {selectedImages.size} selected images and cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteSelectedMutation.mutate(Array.from(selectedImages))}>
                            Delete Images
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredImages.map((image) => (
                    <Card key={image.id} className="overflow-hidden">
                      <div className="aspect-video bg-muted flex items-center justify-center">
                        <ImageIcon className="h-12 w-12 text-muted-foreground" />
                      </div>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedImages.has(image.id)}
                              onCheckedChange={(checked) => handleSelectImage(image.id, checked as boolean)}
                            />
                            <Badge variant="outline">{image.templateName}</Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowImageModal(image)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {formatDate(image.createdAt)}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatFileSize(image.fileSize)}</span>
                          <span>{image.accessCount} accesses</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Template Usage</CardTitle>
              <CardDescription>Distribution of cached images by template</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {templateNames.map(templateName => {
                  const count = images?.filter(img => img.templateName === templateName).length || 0;
                  const percentage = images ? (count / images.length) * 100 : 0;
                  return (
                    <div key={templateName} className="flex items-center justify-between">
                      <span className="text-sm font-medium">{templateName}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-32 bg-muted rounded-full h-2">
                          <div 
                            className="bg-primary h-2 rounded-full" 
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-sm text-muted-foreground w-12 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Most Accessed Images</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {images?.sort((a, b) => b.accessCount - a.accessCount).slice(0, 5).map((image) => (
                    <div key={image.id} className="flex items-center justify-between p-2 border rounded">
                      <span className="text-sm font-medium">{image.templateName}</span>
                      <Badge variant="secondary">{image.accessCount}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Largest Images</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {images?.sort((a, b) => b.fileSize - a.fileSize).slice(0, 5).map((image) => (
                    <div key={image.id} className="flex items-center justify-between p-2 border rounded">
                      <span className="text-sm font-medium">{image.templateName}</span>
                      <span className="text-sm text-muted-foreground">{formatFileSize(image.fileSize)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cache Settings</CardTitle>
              <CardDescription>Manual cache management controls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Storage Location</Label>
                <p className="text-sm text-muted-foreground">./generated_images/</p>
              </div>

              <div>
                <Label>Cache Strategy</Label>
                <p className="text-sm text-muted-foreground">
                  Exact match first, then similarity detection (85% threshold)
                </p>
              </div>

              <div>
                <Label>Cleanup Policy</Label>
                <p className="text-sm text-muted-foreground">
                  Manual cleanup only - no automatic expiration
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Export Cache Data</CardTitle>
              <CardDescription>Download cache metadata for analysis</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => {
                  const data = JSON.stringify(images, null, 2);
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'cache-metadata.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                variant="outline"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Metadata
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Image Detail Modal */}
      {showImageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-4xl max-h-[90vh] overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Image Details</CardTitle>
                <Button variant="outline" onClick={() => setShowImageModal(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="aspect-video bg-muted flex items-center justify-center rounded-lg">
                <ImageIcon className="h-16 w-16 text-muted-foreground" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Template</Label>
                  <p className="text-sm">{showImageModal.templateName}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">File Size</Label>
                  <p className="text-sm">{formatFileSize(showImageModal.fileSize)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Created</Label>
                  <p className="text-sm">{formatDate(showImageModal.createdAt)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Access Count</Label>
                  <p className="text-sm">{showImageModal.accessCount}</p>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Scene Fingerprint</Label>
                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                  {JSON.stringify(showImageModal.sceneFingerprint, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
