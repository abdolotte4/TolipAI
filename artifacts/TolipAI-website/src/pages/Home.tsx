import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { Services } from "@/components/sections/Services";
import { LeadTypes } from "@/components/sections/LeadTypes";
import { Methodology } from "@/components/sections/Methodology";
import { CaseStudies } from "@/components/sections/CaseStudies";
import { Team } from "@/components/sections/Team";
import { About } from "@/components/sections/About";
import { Contact } from "@/components/sections/Contact";
import { SuccessStory } from "@/components/sections/SuccessStory";
import { PerformanceDashboard } from "@/components/sections/PerformanceDashboard";
import { Testimonials } from "@/components/sections/Testimonials";
import { ChatBot } from "@/components/ChatBot";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative">
      <Navbar />
      
      <main>
        <Hero />
        <SuccessStory />
        <Services />
        <LeadTypes />
        <Methodology />
        <PerformanceDashboard />
        <CaseStudies />
        <Testimonials />
        <Team />
        <About />
        <Contact />
      </main>

      <Footer />
      <ChatBot />
    </div>
  );
}
