import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export interface UserSettings {
  theme?: string;
  style?: string;
  imageModelKey?: string;
  /** Story model key. Empty string clears the choice (follow the default). */
  llmModelKey?: string;
  typewriterEnabled?: boolean;
}

/**
 * Hook to fetch user settings from the database.
 * Uses React Query with default queryFn for automatic caching.
 * The endpoint uses session authentication to identify the user.
 */
export function useUserSettings() {
  return useQuery<UserSettings>({
    queryKey: ['api', 'user', 'preferences'],
    enabled: true, // Always enabled - endpoint uses session auth
  });
}

/**
 * Hook to update user settings.
 * Automatically invalidates the user settings cache on success.
 */
export function useUpdateUserSettings() {
  const { toast } = useToast();

  return useMutation<UserSettings, Error, UserSettings>({
    mutationFn: async (payload) => {
      const response = await apiRequest('PATCH', '/api/user/preferences', payload);
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate the user settings cache
      queryClient.invalidateQueries({ queryKey: ['api', 'user', 'preferences'] });
      toast({
        title: "Preferences saved",
        description: "User preferences updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update preferences",
        description: error.message || "Unable to save preferences.",
        variant: "destructive",
      });
    },
  });
}
