import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js", { scope: import.meta.env.BASE_URL })
      .then((reg) => console.info("[SW] registered:", reg.scope))
      .catch((err) => console.warn("[SW] registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
