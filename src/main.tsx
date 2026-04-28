import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppLocal from "./AppLocal.tsx";
import "./index.css";

function pickApp() {
  // Use `/#local` to switch the homepage to local images in `public/my-photos/`.
  return window.location.hash === "#local" ? AppLocal : App;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {(() => {
      const Root = pickApp();
      return <Root />;
    })()}
  </StrictMode>
);
