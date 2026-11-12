import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import LoadingPage from "@/pages/LoadingPage";
import WelcomePage from "@/pages/WelcomePage";
import MainMenuPage from "@/pages/MainMenuPage";
import HelpPage from "@/pages/HelpPage";
import InterviewPage from "@/pages/InterviewPage";
import GamePage from "@/pages/GamePage";
import DevToolsPage from "@/pages/DevToolsPage";
import CacheManagementPage from "@/pages/CacheManagementPage";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoadingPage} />
      <Route path="/welcome" component={WelcomePage} />
      <Route path="/menu" component={MainMenuPage} />
      <Route path="/help" component={HelpPage} />
      <Route path="/interview/:gameId" component={InterviewPage} />
      <Route path="/game/:gameId" component={GamePage} />
      <Route path="/dev-tools" component={DevToolsPage} />
      <Route path="/dev-tools/cache" component={CacheManagementPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
