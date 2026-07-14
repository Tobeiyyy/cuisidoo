import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api, UnauthorizedError } from "./api";
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
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
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
