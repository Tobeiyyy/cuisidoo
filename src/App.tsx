import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api, UnauthorizedError } from "./api";
import Nav from "./components/Nav";
import Login from "./pages/Login";
import Rezepte from "./pages/Rezepte";
import RezeptDetail from "./pages/RezeptDetail";
import RezeptForm from "./pages/RezeptForm";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function KochenPage() {
  return (
    <div className="page no-nav" style={{ background: "var(--cook-bg)" }}>
      <h1>Kochmodus</h1>
    </div>
  );
}

function GenerierenPage() {
  return (
    <div className="page">
      <h1>Generieren</h1>
    </div>
  );
}

function PlanenPage() {
  return (
    <div className="page">
      <h1>Wochenplan</h1>
    </div>
  );
}

function EinkaufenPage() {
  return (
    <div className="page">
      <h1>Einkaufsliste</h1>
    </div>
  );
}

function VorratPage() {
  return (
    <div className="page">
      <h1>Vorrat</h1>
    </div>
  );
}

function EinstellungenPage() {
  return (
    <div className="page">
      <h1>Einstellungen</h1>
    </div>
  );
}

function Shell() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Rezepte />} />
        <Route path="/rezept/:id" element={<RezeptDetail />} />
        <Route path="/rezept/:id/kochen" element={<KochenPage />} />
        <Route path="/rezept/:id/bearbeiten" element={<RezeptForm />} />
        <Route path="/neu" element={<RezeptForm />} />
        <Route path="/generieren" element={<GenerierenPage />} />
        <Route path="/planen" element={<PlanenPage />} />
        <Route path="/einkaufen" element={<EinkaufenPage />} />
        <Route path="/vorrat" element={<VorratPage />} />
        <Route path="/einstellungen" element={<EinstellungenPage />} />
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
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
