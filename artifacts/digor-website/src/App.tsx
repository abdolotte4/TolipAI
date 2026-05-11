import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import Admin from "@/pages/Admin";
import Terms from "@/pages/Terms";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import MissionVisionValues from "@/pages/MissionVisionValues";
import NotFound from "@/pages/not-found";
import { SubscribeModal } from "@/components/SubscribeModal";

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

export const SubscribeModalContext = {
  open: () => {},
};

import { createContext, useContext } from "react";

export const SubscribeContext = createContext<{ openSubscribe: () => void }>({
  openSubscribe: () => {},
});

export function useSubscribe() {
  return useContext(SubscribeContext);
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/admin" component={Admin} />
      <Route path="/terms-of-service" component={Terms} />
      <Route path="/checkout-success" component={CheckoutSuccess} />
      <Route path="/mission-vision-values" component={MissionVisionValues} />
      <Route component={NotFound} />
    </Switch>
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
