import { lazy, Suspense, useEffect, useState } from "react";
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

// ── Offline indicator ──────────────────────────────────────────────────────────
function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-center text-sm py-2 px-4 font-medium">
      Offline mode — some features may be unavailable
    </div>
  );
}

// ── PWA Install Prompt ─────────────────────────────────────────────────────────
function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("pwa-install-dismissed") === "true"
  );

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") {
      setDeferredPrompt(null);
      if (outcome === "dismissed") {
        localStorage.setItem("pwa-install-dismissed", "true");
        setDismissed(true);
      }
    }
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-install-dismissed", "true");
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-card border border-border rounded-lg shadow-lg p-4 max-w-xs">
      <p className="text-sm font-semibold text-foreground mb-1">Add to Home Screen</p>
      <p className="text-xs text-muted-foreground mb-3">
        Install TolipAI Tools for quick access from your home screen.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleInstall}
          className="flex-1 bg-primary text-primary-foreground text-xs font-medium py-2 px-3 rounded-md hover:bg-primary/90 transition-colors min-h-[44px]"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground py-2 px-3 rounded-md hover:bg-secondary transition-colors min-h-[44px]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

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
            <OfflineBanner />
            <Router />
            <InstallPrompt />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
