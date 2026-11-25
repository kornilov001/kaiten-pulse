import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { inTauri } from "./lib/kaiten";
import "./styles.css";

if (!inTauri) document.body.classList.add("preview");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, err) => n < 2 && !["auth", "forbidden", "not_configured"].includes((err as { kind?: string }).kind ?? ""),
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
