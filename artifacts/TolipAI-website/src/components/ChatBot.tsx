import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, X, Send, ChevronDown } from "lucide-react";

const BOT_RESPONSES = [
  {
    keywords: ["price", "pricing", "cost", "rate", "fee", "how much", "package"],
    response: "Our pricing is customized based on your operational scope and service requirements. We offer flexible engagement models for CRM Infrastructure, Workflow Automation, and Pipeline Management services. Please schedule a consultation with our team for a detailed proposal tailored to your needs. You can reach us at info@tolipai.com or call (659) 250-4618."
  },
  {
    keywords: ["service", "offer", "provide", "what do", "what you do"],
    response: "Tolip Group LLC provides workflow automation and CRM infrastructure for real estate professionals:\n\n1. **CRM Support & Pipeline Management** — Data entry, record management, pipeline organization, and administrative operations inside TolipAI CRM\n\n2. **Workflow Automation & Client Communication Tools** — CRM automation configuration, follow-up workflows, notification systems, and pipeline stage triggers\n\n3. **ARV Calculation & Comps Analysis** — Live property data, comparable sales analysis, and Maximum Allowable Offer calculations\n\n4. **Technical CRM Infrastructure** — Purpose-built real estate CRM with pipeline management, task tracking, and team collaboration\n\nWould you like more details about any specific service?"
  },
  {
    keywords: ["data", "analytics", "engineer", "property", "pipeline"],
    response: "Our data analytics and pipeline management services organize and surface property opportunity data inside TolipAI CRM. We structure property records, configure pipeline stages, and build analytics dashboards that give your team clear visibility into every deal — from initial inquiry through closing."
  },
  {
    keywords: ["crm", "technical", "infrastructure", "automation", "workflow"],
    response: "Our Technical CRM Infrastructure service covers enterprise-grade CRM architecture design, workflow automation configuration, and pipeline engineering. TolipAI CRM is purpose-built for real estate professionals — featuring ARV calculations, comps analysis, task tracking, and full team collaboration tools."
  },
  {
    keywords: ["arv", "comps", "comparable", "calculator", "offer", "mao"],
    response: "TolipAI CRM includes a built-in ARV (After Repair Value) calculator and MAO (Maximum Allowable Offer) calculator. These tools automatically pull comparable sales data, adjust for property differences, and give your team data-driven numbers for every deal — no spreadsheets required."
  },
  {
    keywords: ["contact", "email", "phone", "address", "location", "reach", "office"],
    response: "You can reach Tolip Group LLC through the following channels:\n\n📧 General: info@tolipai.com\n📧 Info: hello@tolipai.com\n📧 Technology: martin@tolipai.com\n📞 Phone: (659) 250-4618\n📍 Address: 1309 Coffeen Avenue STE 1200, Sheridan, Wyoming 82801\n\nOur team responds to all inquiries within one business day."
  },
  {
    keywords: ["real estate", "wholesale", "acquisition", "investor", "professional"],
    response: "Tolip Group LLC specializes exclusively in CRM infrastructure and workflow automation for real estate investors and acquisition-focused organizations. Our integrated platform helps real estate professionals manage pipelines, analyze property data, and automate administrative operations — so teams can focus on underwriting and closing."
  },
  {
    keywords: ["team", "who", "people", "founder", "ceo", "staff"],
    response: "Tolip Group LLC is led by an experienced executive team:\n\n👔 Mahmoud Aly — CEO\n⚙️ David Holloway — COO\n📣 Abdullah Gawish — CMO\n💻 Martin Adams — CTO\n📋 Amr ALY — Head Of Finance\n\nOur team brings deep expertise in CRM infrastructure, workflow automation, and technical platform development."
  },
  {
    keywords: ["result", "roi", "return", "performance", "outcome"],
    response: "Our clients achieve measurable operational improvements:\n\n• Streamlined pipeline management with full CRM visibility\n• Automated follow-up workflows reducing manual administrative work\n• Accurate ARV and comps analysis built into every deal review\n• Compliance-focused systems that reduce operational risk\n\nEvery engagement is backed by our Human-in-the-Loop QA protocol and Operational Compliance Framework."
  },
  {
    keywords: ["compliance", "regulation", "legal", "standard"],
    response: "Compliance is foundational to everything we do at Tolip Group LLC. Our platform is designed with compliance-focused systems at its core — from CRM record management to workflow automation. Our Operational Compliance Framework ensures all systems and processes meet applicable regulatory standards, and our Human-in-the-Loop QA process provides human oversight at every stage."
  },
  {
    keywords: ["about", "company", "founded", "wyoming", "llc", "established"],
    response: "TolipAI, a division of Tolip Group LLC, provides workflow automation and CRM infrastructure for real estate professionals. Our platform helps businesses streamline operations, manage property pipelines, and analyze data with compliance-focused systems. Established in 2026, we are a registered Wyoming Limited Liability Company providing specialized B2B infrastructure solutions for real estate investors and acquisition-focused organizations nationwide."
  },
  {
    keywords: ["start", "begin", "get started", "onboard", "sign up", "work together"],
    response: "Getting started with Tolip Group LLC is straightforward:\n\n1. Schedule a consultation — contact us at info@tolipai.com\n2. We'll assess your operational needs and current CRM infrastructure\n3. We'll propose a customized service engagement\n4. Onboarding typically takes 1-2 weeks\n\nReady to streamline your operations? Use the contact form below or call us at (659) 250-4618."
  }
];

type Message = {
  id: string;
  text: string;
  sender: "bot" | "user";
};

export function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      text: "Hello! I'm the Tolip Group LLC assistant. How can I help you today? You can ask me about our CRM infrastructure services, workflow automation, pricing, or contact information.",
      sender: "bot"
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue.trim(),
      sender: "user"
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");

    setTimeout(() => {
      const lowerInput = userMessage.text.toLowerCase();
      let foundResponse = false;

      for (const item of BOT_RESPONSES) {
        if (item.keywords.some(keyword => lowerInput.includes(keyword))) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            text: item.response,
            sender: "bot"
          }]);
          foundResponse = true;
          break;
        }
      }

      if (!foundResponse) {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: "I'd be happy to connect you with our team for more specific information. Please reach out at info@tolipai.com or call (659) 250-4618, and a specialist will assist you promptly.",
          sender: "bot"
        }]);
      }
    }, 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="mb-4 w-[350px] h-[450px] bg-card border border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden"
          >
            <div className="bg-primary p-4 border-b border-primary/20 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-primary-foreground tracking-wider">TOLIPAI</h3>
                <p className="text-xs text-primary-foreground/70">Virtual Assistant</p>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-primary-foreground/70 hover:text-primary-foreground transition-colors p-1"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div 
                    className={`max-w-[85%] rounded-2xl p-3 text-sm whitespace-pre-wrap ${
                      msg.sender === "user" 
                        ? "bg-primary text-primary-foreground rounded-br-sm" 
                        : "bg-secondary text-foreground rounded-bl-sm"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-border bg-card flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4 ml-[-2px]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg shadow-primary/30 flex items-center justify-center relative"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!isOpen && (
          <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-background" />
        )}
      </motion.button>
    </div>
  );
}
