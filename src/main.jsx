import React from "react";
import ReactDOM from "react-dom/client";

// Self-hosted so the type renders instantly and offline — no FOUT, no third-party fetch.
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/plus-jakarta-sans";

import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
