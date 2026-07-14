import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Link, useParams } from "react-router-dom";
import { api, UnauthorizedError } from "./api";
import Nav from "./components/Nav";
import Login from "./pages/Login";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function SettingsGearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RezeptePage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Guten Abend</div>
          <h1>Meine Rezepte</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/neu" className="icon-btn" aria-label="Neues Rezept">
            <PlusIcon />
          </Link>
          <Link to="/einstellungen" className="icon-btn" aria-label="Einstellungen">
            <SettingsGearIcon />
          </Link>
        </div>
      </div>
      <p style={{ color: "var(--tx3)", fontSize: 14 }}>Die Rezeptbibliothek folgt in Task 8.</p>
    </div>
  );
}

function RezeptDetailPage() {
  const { id } = useParams();
  return (
    <div className="page">
      <h1>Rezept {id}</h1>
    </div>
  );
}

function KochenPage() {
  return (
    <div className="page no-nav" style={{ background: "var(--cook-bg)" }}>
      <h1>Kochmodus</h1>
    </div>
  );
}

function NeuPage() {
  return (
    <div className="page">
      <h1>Neues Rezept</h1>
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
        <Route path="/" element={<RezeptePage />} />
        <Route path="/rezept/:id" element={<RezeptDetailPage />} />
        <Route path="/rezept/:id/kochen" element={<KochenPage />} />
        <Route path="/neu" element={<NeuPage />} />
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
  const { data, error, isLoading } = useQuery({
    queryKey: ["auth-check"],
    queryFn: () => api<{ ok: true }>("/api/auth/check"),
  });

  if (isLoading) return null;
  if (error instanceof UnauthorizedError || !data) return <Login />;
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
