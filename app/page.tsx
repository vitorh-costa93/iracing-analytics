"use client";

import { useEffect, useState } from "react";

type SyncResult = {
  status?: string;
  driver?: {
    id?: string;
    platform?: string;
    platform_driver_id?: string;
    name?: string;
  };
  ratingsInserted?: number;
  message?: string;
};

export default function Home() {
  const [profile, setProfile] = useState<any>();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    fetch("/api/iracing/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => null);
  }, []);

  async function syncGarage61() {
    setSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch("/api/sync/profile", {
        method: "POST",
      });

      const data = await response.json();

      setSyncResult(data);
    } catch (error) {
      setSyncResult({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Erro ao sincronizar",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main>
      <div className="card">
        <small>IRACING ANALYTICS</small>

        <h1>Racing Analytics</h1>

        <p>
          Dados de performance do iRacing integrados via Garage61.
        </p>

        <button
          onClick={syncGarage61}
          disabled={syncing}
          style={{
            padding: "12px 18px",
            borderRadius: "8px",
            border: "none",
            cursor: syncing ? "not-allowed" : "pointer",
            fontWeight: 600,
            marginTop: "16px",
          }}
        >
          {syncing
            ? "Sincronizando..."
            : "Sincronizar Garage61"}
        </button>

        {syncResult?.status === "ok" && (
          <div
            style={{
              marginTop: "20px",
              padding: "16px",
              borderRadius: "8px",
              background: "#13291d",
            }}
          >
            <strong>✓ Sincronização concluída</strong>

            <p>
              Piloto: {syncResult.driver?.name}
            </p>

            <p>
              Ratings inseridos: {syncResult.ratingsInserted}
            </p>
          </div>
        )}

        {syncResult?.status === "error" && (
          <div
            style={{
              marginTop: "20px",
              padding: "16px",
              borderRadius: "8px",
              background: "#30181b",
            }}
          >
            <strong>Erro na sincronização</strong>

            <p>{syncResult.message}</p>
          </div>
        )}

        {profile?.authenticated && (
          <div style={{ marginTop: "30px" }}>
            <h2>Perfil</h2>

            <pre>
              {JSON.stringify(profile.profile, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
