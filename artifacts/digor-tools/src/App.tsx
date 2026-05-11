import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/use-auth";

const NotFound      = lazy(() => import("@/pages/not-found"));
const Login         = lazy(() => import("@/pages/Login"));
const SkipTrace     = lazy(() => import("@/pages/SkipTrace"));
const Distressed    = lazy(() => import("@/pages/Distressed"));
const Arv           = lazy(() => import("@/pages/Arv"));
const PropertyLookup = lazy(() => import("@/pages/PropertyLookup"));
const LeadScraper   = lazy(() => import("@/pages/LeadScraper"));
const AiDistressed  = lazy(() => import("@/pages/AiDistressed"));
const SatelliteDFD  = lazy(() => import("@/pages/SatelliteDFD"));
const PhoneFinder   = lazy(() => import("@/pages/PhoneFinder"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground tracking-widest font-mono text-sm">
        SYSTEM LOADING...
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <PageLoader />;

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
    <Suspense fallback={<PageLoader />}>
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
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
