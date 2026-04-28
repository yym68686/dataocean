import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design-system/css/market-system.css";
import "./styles/app.css";
import App from "./App";
import { DisplayCurrencyProvider } from "./lib/displayCurrency";
import { I18nProvider } from "./lib/i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <DisplayCurrencyProvider>
        <App />
      </DisplayCurrencyProvider>
    </I18nProvider>
  </StrictMode>,
);
