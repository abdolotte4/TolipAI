import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/use-auth";

import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import SkipTrace from "@/pages/SkipTrace";
import Distressed from "@/pages/Distressed";
import Arv from "@/pages/Arv";
import PropertyLookup from "@/pages/PropertyLookup";
import LeadScraper from "@/pages/LeadScraper";
import AiDistressed from "@/pages/AiDistressed";
import SatelliteDFD from "@/pages/SatelliteDFD";
import PhoneFinder from "@/pages/PhoneFinder";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground tracking-widest font-mono text-sm">
          SYSTEM LOADING...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    setLocation("/login");
    return null;
  }

  return (
    <AppLayout>
      <Component {...rest} />
    </AppLayout>
  );
}

function RootRedirect() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  if (isAuthenticated) {
    setLocation("/contact-enrichment");
  } else {
    setLocation("/login");
  }
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={RootRedirect} />
      <Route path="/contact-enrichment">
        {() => <ProtectedRoute component={SkipTrace} />}
      </Route>
      <Route path="/skip-trace">
        {() => <ProtectedRoute component={SkipTrace} />}
      </Route>
      <Route path="/opportunity-finder">
        {() => <ProtectedRoute component={Distressed} />}
      </Route>
      <Route path="/distressed">
        {() => <ProtectedRoute component={Distressed} />}
      </Route>
      <Route path="/ai-distressed">
        {() => <ProtectedRoute component={AiDistressed} />}
      </Route>
      <Route path="/arv">
        {() => <ProtectedRoute component={Arv} />}
      </Route>
      <Route path="/property-lookup">
        {() => <ProtectedRoute component={PropertyLookup} />}
      </Route>
      <Route path="/lead-scraper">
        {() => <ProtectedRoute component={LeadScraper} />}
      </Route>
      <Route path="/satellite-dfd">
        {() => <ProtectedRoute component={SatelliteDFD} />}
      </Route>
      <Route path="/phone-finder">
        {() => <ProtectedRoute component={PhoneFinder} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
