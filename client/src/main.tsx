import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient, REFERENCE_DATA_QUERY_OPTIONS, getQueryFn } from "./lib/queryClient";

// Prefetch all reference data at startup before rendering app
async function prefetchReferenceData() {
  const queryFn = getQueryFn({ on401: "throw" });
  
  // Prefetch all reference endpoints in parallel
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'story-themes'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'visual-styles'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'system-defaults'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['api', 'reference', 'image-models'],
      queryFn,
      ...REFERENCE_DATA_QUERY_OPTIONS,
    }),
  ]);
}

// Prefetch reference data, then render app
prefetchReferenceData()
  .then(() => {
    createRoot(document.getElementById("root")!).render(<App />);
  })
  .catch((error) => {
    console.error("Failed to prefetch reference data:", error);
    // Still render app even if prefetch fails (queries will fetch on demand)
    createRoot(document.getElementById("root")!).render(<App />);
  });
