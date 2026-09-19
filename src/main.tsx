import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import "./i18n";

try {
  const raw = localStorage.getItem('flint-settings');
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.theme) {
      const themeMap: Record<string, string> = {
        graphite: 'dark',
        sunset: 'amber',
      };
      document.body.dataset.theme = themeMap[parsed.theme] || parsed.theme;
    }
  }
} catch {
  // Ignore malformed local settings
}

if (!document.body.dataset.theme) {
  document.body.dataset.theme = 'dark';
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
