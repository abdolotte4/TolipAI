import { useState, useEffect } from "react";

export function useAuth() {
  const [pin, setPin] = useState<string | null>(() => localStorage.getItem("tolipai_tools_pin"));
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!pin);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const verifyPin = async () => {
      if (!pin) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/tools/auth/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tools-Pin": pin
          },
          body: JSON.stringify({ pin })
        });

        if (res.ok) {
          setIsAuthenticated(true);
          localStorage.setItem("tolipai_tools_pin", pin);
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem("tolipai_tools_pin");
          setPin(null);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    verifyPin();
  }, [pin]);

  const login = async (newPin: string) => {
    const res = await fetch("/api/tools/auth/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tools-Pin": newPin
      },
      body: JSON.stringify({ pin: newPin })
    });

    if (res.ok) {
      setPin(newPin);
      localStorage.setItem("tolipai_tools_pin", newPin);
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    setPin(null);
    localStorage.removeItem("tolipai_tools_pin");
    setIsAuthenticated(false);
  };

  return { pin, isAuthenticated, isLoading, login, logout };
}
