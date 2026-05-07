import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Redirect if already authenticated
  if (isAuthenticated) {
    setLocation("/contact-enrichment");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;

    setIsLoading(true);
    try {
      const success = await login(pin);
      if (success) {
        toast({ title: "Access Granted", description: "Welcome to TolipAI Tools." });
        setLocation("/contact-enrichment");
      } else {
        toast({ 
          title: "Access Denied", 
          description: "Invalid PIN. Please try again.",
          variant: "destructive" 
        });
        setPin("");
      }
    } catch (err) {
      toast({ 
        title: "Error", 
        description: "Failed to verify PIN.",
        variant: "destructive" 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md border-border/50 shadow-2xl relative z-10 bg-card/80 backdrop-blur-xl">
        <CardHeader className="space-y-4 pb-8 text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
            <Database className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-bold tracking-tight">TolipAI Tools</CardTitle>
            <CardDescription className="text-base">
              Authorized personnel only. Enter your PIN to continue.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="pin" className="sr-only">PIN</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                <Input
                  id="pin"
                  type="password"
                  placeholder="Enter access PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="pl-10 h-12 text-lg tracking-widest text-center font-mono bg-background/50 border-border/50 focus:border-primary focus:ring-primary/50"
                  autoFocus
                  disabled={isLoading}
                />
              </div>
            </div>
            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-primary/25 transition-all" 
              disabled={isLoading || !pin}
            >
              {isLoading ? "Verifying..." : "Access System"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
