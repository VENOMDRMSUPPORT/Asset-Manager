import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ─── Monaco internal error suppression ────────────────────────────────────────
// Monaco's mouse hit-testing calls document.caretPositionFromPoint() which
// returns null in some sandboxed iframe / Replit preview contexts (Firefox and
// certain Chromium builds). Monaco does not guard against this null case,
// so it throws "can't access property offsetNode, i is null" from its CDN
// script on mouse-move over the editor.
//
// The editor remains fully functional — the error is purely internal to Monaco.
// We suppress it here so it doesn't surface as a fatal overlay in the dev UI.
window.addEventListener(
  "error",
  (event) => {
    const fromMonaco = event.filename?.includes("monaco-editor") === true;
    if (fromMonaco) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true   // capture phase — fires before the Vite runtime-error plugin sees it
);

createRoot(document.getElementById("root")!).render(<App />);
