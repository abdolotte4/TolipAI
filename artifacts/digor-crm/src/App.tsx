import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupFetchInterceptor } from "./lib/api-setup";
import { AppLayout } from "./components/layout/AppLayout";

// Setup global fetch interceptor immediately
setupFetchInterceptor();

// Page Imports
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import LeadList from "@/pages/leads/LeadList";
import NewLead from "@/pages/leads/NewLead";
import LeadDetail from "@/pages/leads/LeadDetail";
import TaskList from "@/pages/tasks/TaskList";
import UserList from "@/pages/admin/UserList";
import LinkList from "@/pages/admin/LinkList";
import SubmitLead from "@/pages/public/SubmitLead";
import CampaignList from "@/pages/campaigns/CampaignList";
import Pipeline from "@/pages/pipeline/Pipeline";
import SequenceList from "@/pages/sequences/SequenceList";
import BuyersList from "@/pages/buyers/BuyersList";
import CashBuyersAll from "@/pages/buyers/CashBuyersAll";
import DistressedLeadGen from "@/pages/leadgen/DistressedLeadGen";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: false,
      staleTime: 30_000, // data stays fresh 30s — no unnecessary refetches on re-mount
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Public Routes */}
      <Route path="/login" component={Login} />
      <Route path="/submit/:token" component={SubmitLead} />

      {/* Super Admin: Campaigns */}
      <Route path="/campaigns">
        <AppLayout>
          <CampaignList />
        </AppLayout>
      </Route>

      {/* Dashboard */}
      <Route path="/">
        <AppLayout>
          <Dashboard />
        </AppLayout>
      </Route>

      <Route path="/leads">
        <AppLayout>
          <LeadList />
        </AppLayout>
      </Route>

      <Route path="/leads/new">
        <AppLayout>
          <NewLead />
        </AppLayout>
      </Route>

      <Route path="/leads/:id">
        <AppLayout>
          <LeadDetail />
        </AppLayout>
      </Route>

      <Route path="/tasks">
        <AppLayout>
          <TaskList />
        </AppLayout>
      </Route>

      <Route path="/admin/users">
        <AppLayout>
          <UserList />
        </AppLayout>
      </Route>

      <Route path="/admin/links">
        <AppLayout>
          <LinkList />
        </AppLayout>
      </Route>

      <Route path="/pipeline">
        <AppLayout>
          <Pipeline />
        </AppLayout>
      </Route>

      <Route path="/buyers">
        {() => (
          <AppLayout><BuyersList /></AppLayout>
        )}
      </Route>

      <Route path="/cash-buyers">
        <AppLayout>
          <CashBuyersAll />
        </AppLayout>
      </Route>

      <Route path="/lead-gen">
        <AppLayout>
          <DistressedLeadGen />
        </AppLayout>
      </Route>

      <Route path="/admin/sequences">
        <AppLayout>
          <SequenceList />
        </AppLayout>
      </Route>

      <Route>
        <AppLayout>
          <NotFound />
        </AppLayout>
      </Route>
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
