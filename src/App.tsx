import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api, UnauthorizedError } from "./api";
import { flushOutbox } from "./offline";
import Nav from "./components/Nav";
import Login from "./pages/Login";
import Rezepte from "./pages/Rezepte";
import RezeptDetail from "./pages/RezeptDetail";
import RezeptForm from "./pages/RezeptForm";
import Generieren from "./pages/Generieren";
import Vorrat from "./pages/Vorrat";
import Einstellungen from "./pages/Einstellungen";
import Planen from "./pages/Planen";
import Einkaufen from "./pages/Einkaufen";
import Kochmodus from "./pages/Kochmodus";

// Task 17: networkMode "always" is required so queries still *run* while the browser is
// offline — our queryFns (useRecipe, Einkaufen's shopping list) do their own try/catch and fall
// back to the IndexedDB mirror. TanStack Query's default networkMode ("online") pauses queries
// entirely while navigator.onLine is false, which would prevent that fallback from ever running.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, networkMode: "always" } },
});

function Shell() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Rezepte />} />
        <Route path="/rezept/:id" element={<RezeptDetail />} />
        <Route path="/rezept/:id/kochen" element={<Kochmodus />} />
        <Route path="/rezept/:id/bearbeiten" element={<RezeptForm />} />
        <Route path="/neu" element={<RezeptForm />} />
        <Route path="/generieren" element={<Generieren />} />
        <Route path="/planen" element={<Planen />} />
        <Route path="/einkaufen" element={<Einkaufen />} />
        <Route path="/vorrat" element={<Vorrat />} />
        <Route path="/einstellungen" element={<Einstellungen />} />
      </Routes>
      <Nav />
    </>
  );
}

function AuthGate() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["auth-check"],
    queryFn: () => api<{ ok: true }>("/api/auth/check"),
  });

  if (isLoading) return null;

  if (error instanceof UnauthorizedError) return <Login />;

  // Any other failure (network error, worker unreachable, etc.) means we can't tell whether the
  // session is still valid — but the installed PWA relaunching offline is exactly this case, and
  // each page already falls back to its IndexedDB mirror / shows its own error state. Blocking
  // the whole app behind a fullscreen error card here would lock users out of their offline-
  // available recipes and shopping list, so proceed into the app instead of refusing to render.
  if (error || !data) {
    return (
      <>
        <div role="status" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, textAlign: "center", fontSize: 12, padding: "4px 0", background: "var(--surface)", color: "var(--tx4)" }}>
          Offline — Verbindung konnte nicht geprüft werden.
        </div>
        <Shell />
      </>
    );
  }

  return <Shell />;
}

export default function App() {
  // Task 17: replay any queued shopping-list PATCHes on app start and whenever the browser
  // regains connectivity.
  useEffect(() => {
    void flushOutbox();
    function onOnline() {
      void flushOutbox();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
