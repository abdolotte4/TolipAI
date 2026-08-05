import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-card border-t border-border pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2">
            <span className="font-display text-2xl font-bold tracking-wider text-foreground">
              TOLIPAI<span className="text-primary">.</span>
            </span>
            <p className="mt-4 text-muted-foreground max-w-sm">
              CRM software and workflow automation for real estate professionals. TolipAI helps teams manage lead pipelines, ARV calculations, comps analysis, and operational tasks — all in one platform.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold text-foreground mb-4">Platform</h4>
            <ul className="space-y-2">
              {[
                { label: 'Services', href: '#services' },
                { label: 'Methodology', href: '#methodology' },
                { label: 'Case Studies', href: '#case-studies' },
                { label: 'About', href: '#about' },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-muted-foreground hover:text-primary transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/pricing" className="text-muted-foreground hover:text-primary transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/blog" className="text-muted-foreground hover:text-primary transition-colors">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-primary transition-colors">
                  Help Docs
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Contact</h4>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <a href="mailto:info@tolipai.com" className="hover:text-primary transition-colors">info@tolipai.com</a>
              </li>
              <li>(659) 250-4618</li>
            </ul>
            <div className="mt-4 pt-4 border-t border-border/50">
              <h4 className="font-semibold text-foreground mb-2 text-sm">Legal &amp; Compliance</h4>
              <ul className="space-y-1">
                <li>
                  <Link href="/terms-of-service" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link href="/privacy-policy" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/cookie-policy" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                    Cookie Policy
                  </Link>
                </li>
                <li>
                  <Link href="/acceptable-use" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                    Acceptable Use Policy
                  </Link>
                </li>
                <li>
                  <Link href="/compliance" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                    Compliance
                  </Link>
                </li>
                <li>
                  <Link href="/mission-vision-values" className="text-muted-foreground hover:text-primary transition-colors text-sm">
                    Mission, Vision &amp; Values
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-border/50 flex flex-col md:flex-row justify-between items-center text-sm text-muted-foreground">
          <p>© 2026 Tolip Group LLC. TolipAI is a brand operated by Tolip Group LLC. All rights reserved.</p>
          <p className="mt-2 md:mt-0 text-center md:text-right">
            Wyoming Limited Liability Company <br className="md:hidden" />
            <span className="hidden md:inline"> | </span>
            1309 Coffeen Avenue STE 1200, Sheridan, Wyoming 82801
          </p>
        </div>
      </div>
    </footer>
  );
}
