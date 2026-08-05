import { useState, lazy, Suspense, createContext, useContext } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SubscribeModal } from "@/components/SubscribeModal";

const Home               = lazy(() => import("@/pages/Home"));
const Admin              = lazy(() => import("@/pages/Admin"));
const Terms              = lazy(() => import("@/pages/Terms"));
const PrivacyPolicy      = lazy(() => import("@/pages/PrivacyPolicy"));
const CheckoutSuccess    = lazy(() => import("@/pages/CheckoutSuccess"));
const MissionVisionValues = lazy(() => import("@/pages/MissionVisionValues"));
const Demo               = lazy(() => import("@/pages/Demo"));
const NotFound           = lazy(() => import("@/pages/not-found"));
const Pricing            = lazy(() => import("@/pages/Pricing"));
const Docs               = lazy(() => import("@/pages/Docs"));
const Blog               = lazy(() => import("@/pages/Blog"));
const Compliance         = lazy(() => import("@/pages/Compliance"));
const CookiePolicy       = lazy(() => import("@/pages/CookiePolicy"));

const WP_PARAMS = ["p", "page_id", "cat", "tag", "author", "feed", "s", "attachment_id"];
const searchParams = new URLSearchParams(window.location.search);
if (WP_PARAMS.some(param => searchParams.has(param))) {
  window.location.replace("/");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

export const SubscribeContext = createContext<{ openSubscribe: () => void }>({
  openSubscribe: () => {},
});

export function useSubscribe() {
  return useContext(SubscribeContext);
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground tracking-widest font-mono text-sm">
        Loading…
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        {/* /crm and any sub-path redirect to homepage — CRM is not publicly accessible */}
        <Route path="/crm">{() => <Redirect to="/" />}</Route>
        <Route path="/crm/:rest*">{() => <Redirect to="/" />}</Route>
        <Route path="/admin" component={Admin} />
        <Route path="/terms-of-service" component={Terms} />
        <Route path="/privacy-policy" component={PrivacyPolicy} />
        <Route path="/checkout-success" component={CheckoutSuccess} />
        <Route path="/mission-vision-values" component={MissionVisionValues} />
        <Route path="/demo" component={Demo} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/docs" component={Docs} />
        <Route path="/help" component={Docs} />
        <Route path="/blog" component={Blog} />
        <Route path="/compliance" component={Compliance} />
        <Route path="/acceptable-use" component={Compliance} />
        <Route path="/cookie-policy" component={CookiePolicy} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SubscribeContext.Provider value={{ openSubscribe: () => setSubscribeOpen(true) }}>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <SubscribeModal isOpen={subscribeOpen} onClose={() => setSubscribeOpen(false)} />
            <Toaster />
          </SubscribeContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
