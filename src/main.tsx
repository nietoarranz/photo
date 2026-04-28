import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppLocal from "./AppLocal.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppLocal />
  </StrictMode>
);
