import { useState } from "react";

export default function Login() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Falsche Passphrase");
        setLoading(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Verbindung fehlgeschlagen. Bitte erneut versuchen.");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form onSubmit={handleSubmit} className="card" style={{ width: "100%", maxWidth: 340, padding: 28 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Cuisidoo</h1>
        <p style={{ fontSize: 14, color: "var(--tx3)", margin: "0 0 20px" }}>
          Bitte gib die Passphrase ein, um fortzufahren.
        </p>
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {error && (
          <p style={{ fontSize: 13, color: "var(--accent)", margin: "0 0 12px" }} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn-accent" disabled={loading || !passphrase}>
          {loading ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
