/**
 * Desktop application entry — reuses the web app's components, providers
 * and page unchanged. Everything is bundled locally (fonts included), so
 * the application runs fully offline.
 */
import React from "react";
import { createRoot } from "react-dom/client";

// The fetch shim must be installed before anything can issue requests.
import "./fetch-shim";
import "./desktop.css";

// Local fonts (no network access at runtime).
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";

// Same stylesheet as the web app (Tailwind v4 theme).
import "../src/app/globals.css";

import { Providers } from "../src/app/providers";
import Home from "../src/app/page";
import { Toaster } from "../src/components/ui/toaster";
import { MenuThemeBridge, MenuLanguageBridge, MenuJobBridge } from "./menu-events";
import { DesktopFirstRun } from "./first-run";

// Desktop defaults: European Portuguese on first run, EUR formatting.
try {
  if (!localStorage.getItem("household-budget-lang")) {
    localStorage.setItem("household-budget-lang", "pt");
  }
} catch {
  /* ignore */
}

// The web page uses document.title set by NamesProvider — keep a sensible
// initial value for the window.
document.title = "Finanças da Casa";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <Home />
      <DesktopFirstRun />
      <MenuThemeBridge />
      <MenuLanguageBridge />
      <MenuJobBridge />
      <Toaster />
    </Providers>
  </React.StrictMode>,
);
