import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installProctorEngine } from "./exam/proctorBridge";
import { createEngine } from "./proctoring/engine";
import "./index.css";

// The exam page gets the real proctoring engine here. Tests do not run this file, so they keep
// using their own fake engines.
installProctorEngine(() => createEngine());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
