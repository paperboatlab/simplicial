// Simplicial's page: React Flow's base styles, the kit's styles, then the app's own (app.css), then the app.
import "@xyflow/react/dist/base.css";
import "@paperboatlab/ui/tokens.css";
import "@paperboatlab/ui/ui.css";
import "./app.css";
import { ReactFlowProvider } from "@xyflow/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

document.documentElement.dataset.app = "simplicial";
createRoot(document.getElementById("root")!).render(<StrictMode><ReactFlowProvider><App /></ReactFlowProvider></StrictMode>);
