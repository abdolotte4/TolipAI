import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Database, Search, Calculator, Home, LogOut, Globe2, Sparkles, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();

  const navItems = [
    { href: "/contact-enrichment", label: "Contact Enrichment", icon: Database },
    { href: "/opportunity-finder", label: "Opportunity Finder", icon: Search },
    { href: "/ai-distressed", label: "AI Multi-Source", icon: Sparkles },
    { href: "/satellite-dfd", label: "SkyDrive AI", icon: Satellite },
    { href: "/arv", label: "ARV Calculator", icon: Calculator },
    { href: "/property-lookup", label: "Property Lookup", icon: Home },
    { href: "/lead-scraper", label: "Lead Scraper", icon: Globe2 },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
            <div className="w-4 h-4 bg-primary rounded-sm" />
            DIGOR TOOLS
          </div>
        </div>
        
        <nav className="flex-1 py-6 px-3 flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}>
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={logout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
