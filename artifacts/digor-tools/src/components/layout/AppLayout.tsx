import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  Database, Search, Calculator, Home, LogOut,
  Globe2, Sparkles, Satellite, Phone, Menu, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar when route changes (mobile nav)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Close sidebar on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const navItems: NavItem[] = [
    { href: "/contact-enrichment", label: "Contact Enrichment", icon: Database },
    { href: "/opportunity-finder", label: "Opportunity Finder", icon: Search },
    { href: "/ai-distressed", label: "AI Multi-Source", icon: Sparkles },
    { href: "/satellite-dfd", label: "SkyDrive AI", icon: Satellite },
    { href: "/arv", label: "ARV Calculator", icon: Calculator },
    { href: "/property-lookup", label: "Property Lookup", icon: Home },
    { href: "/lead-scraper", label: "Lead Scraper", icon: Globe2 },
    { href: "/phone-finder", label: "Phone Finder", icon: Phone },
  ];

  const NavContent = () => (
    <>
      <nav className="flex-1 py-6 px-3 flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = location === href;
          return (
            <Link key={href} href={href}>
              <div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer min-h-[44px] ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground min-h-[44px]"
          onClick={logout}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — desktop always visible, mobile slide-in */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 border-r border-border bg-card flex flex-col transition-transform duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Logo/Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-border shrink-0">
          <div className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
            <div className="w-4 h-4 bg-primary rounded-sm" />
            TOLIPAI TOOLS
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden -mr-2 h-8 w-8 min-h-[44px] min-w-[44px]"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <NavContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {/* Mobile top bar */}
        <div className="lg:hidden h-14 flex items-center px-4 border-b border-border shrink-0 bg-card">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 min-h-[44px] min-w-[44px]"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 font-bold text-base text-primary tracking-tight ml-3">
            <div className="w-3 h-3 bg-primary rounded-sm" />
            TOLIPAI TOOLS
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
