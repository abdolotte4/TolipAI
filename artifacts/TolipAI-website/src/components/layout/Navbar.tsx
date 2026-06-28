import { useState, useEffect } from "react";
import { Menu, X, Zap, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscribe } from "@/App";
import { useTheme } from "@/hooks/use-theme";

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { openSubscribe } = useSubscribe();
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Services", href: "#services" },
    { name: "Methodology", href: "#methodology" },
    { name: "Case Studies", href: "#case-studies" },
    { name: "About", href: "#about" },
  ];

  const scrollTo = (href: string) => {
    setMobileMenuOpen(false);
    if (href.startsWith("#")) {
      if (window.location.pathname !== "/") {
        window.location.href = "/" + href;
        return;
      }
      const element = document.querySelector(href);
      if (element) element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled ? "bg-background/80 backdrop-blur-md border-b border-border shadow-lg shadow-black/20 py-3" : "bg-transparent py-5"}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">

        {/* Logo */}
        <a href="/" className="flex items-center gap-2 cursor-pointer group flex-shrink-0">
          <img
            src={isDark ? "/logo-gold.png" : "/logo.png"}
            alt="TolipAI"
            className="h-8 w-8 object-contain"
          />
          <span className="font-display text-xl font-bold tracking-wider text-foreground group-hover:text-primary transition-colors">
            TOLIPAI<span className="text-primary">.</span>
          </span>
        </a>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-4 xl:gap-5 flex-1 justify-end">
          {navLinks.map((link) => (
            <button key={link.name} onClick={() => scrollTo(link.href)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
              {link.name}
            </button>
          ))}
          <a href="/pricing"
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
            Pricing
          </a>
          <a href="/blog"
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
            Blog
          </a>
          <a href="/docs"
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
            Help
          </a>
          <Button
            onClick={openSubscribe}
            variant="outline"
            size="sm"
            className="border-primary/50 text-primary hover:bg-primary/10 rounded-full px-4 font-semibold text-xs flex items-center gap-1.5 flex-shrink-0"
          >
            <Zap className="w-3 h-3" /> Subscribe
          </Button>
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="p-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <Button onClick={() => scrollTo("#contact")} size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-5 font-semibold text-xs flex-shrink-0">
            Request a Demo
          </Button>
        </div>

        {/* Mobile / medium — hamburger */}
        <div className="lg:hidden flex items-center gap-2">
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="p-2 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-foreground p-2">
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-card border-b border-border shadow-xl">
          <div className="flex flex-col px-4 py-6 space-y-4">
            {navLinks.map((link) => (
              <button key={link.name} onClick={() => scrollTo(link.href)}
                className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
                {link.name}
              </button>
            ))}
            <a href="/pricing" onClick={() => setMobileMenuOpen(false)}
              className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
              Pricing
            </a>
            <a href="/blog" onClick={() => setMobileMenuOpen(false)}
              className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
              Blog
            </a>
            <a href="/docs" onClick={() => setMobileMenuOpen(false)}
              className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
              Help Docs
            </a>
            <a href="/mission-vision-values" onClick={() => setMobileMenuOpen(false)}
              className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
              Mission, Vision &amp; Values
            </a>
            <Button onClick={() => { setMobileMenuOpen(false); openSubscribe(); }}
              variant="outline"
              className="w-full border-primary/50 text-primary hover:bg-primary/10 flex items-center justify-center gap-2">
              <Zap className="w-4 h-4" /> Subscribe
            </Button>
            <Button onClick={() => scrollTo("#contact")} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Request a Demo
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}
