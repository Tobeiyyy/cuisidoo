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
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["auth-check"],
    queryFn: () => api<{ ok: true }>("/api/auth/check"),
  });

  if (isLoading) return null;

  if (error instanceof UnauthorizedError || !data) {
    if (error instanceof UnauthorizedError) {
      return <Login />;
    }
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ textAlign: "center" }}>
          <p>Verbindung fehlgeschlagen.</p>
          <button className="btn-accent" onClick={() => refetch()}>
            Erneut versuchen
          </button>
        </div>
      </div>
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
