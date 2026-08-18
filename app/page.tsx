"use client";

import { useState } from "react";

type SyncResult = {
  status?: string;
  driver?: {
    id?: string;
    name?: string;
  };
  ratingsInserted?: number;
  carsSynced?: number;
  tracksSynced?: number;
  statisticsSynced?: number;
  message?: string;
};

export default function Home() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] =
    useState<SyncResult | null>(null);

  async function syncAll() {
    setSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch("/api/sync/all", {
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
            : "Erro desconhecido",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0d10",
        color: "#f4f5f7",
        padding: "48px 24px",
        fontFamily:
          'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          background: "#14171c",
          border: "1px solid #282d35",
          borderRadius: "18px",
          padding: "32px",
        }}
      >
        <small
          style={{
            color: "#9ca3af",
            letterSpacing: "0.12em",
            fontWeight: 700,
          }}
        >
          IRACING ANALYTICS
        </small>

        <h1
          style={{
            fontSize: "48px",
            marginBottom: "12px",
          }}
        >
          Racing Analytics
        </h1>

        <p
          style={{
            color: "#a7adb7",
            lineHeight: 1.6,
          }}
        >
          Sincronize seus dados do Garage61 com o Supabase.
        </p>

        <button
          onClick={syncAll}
          disabled={syncing}
          style={{
            marginTop: "22px",
            padding: "14px 20px",
            borderRadius: "10px",
            border: "none",
            cursor: syncing
              ? "not-allowed"
              : "pointer",
            fontWeight: 700,
            fontSize: "15px",
            background: syncing ? "#4b5563" : "#f4f5f7",
            color: "#0b0d10",
          }}
        >
          {syncing
            ? "Sincronizando..."
            : "Sincronizar tudo"}
        </button>

        {syncResult?.status === "ok" && (
          <div
            style={{
              marginTop: "28px",
              padding: "20px",
              background: "#13291d",
              borderRadius: "12px",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                color: "#9be2b1",
              }}
            >
              ✓ Sincronização concluída
            </h2>

            <p>
              <strong>Piloto:</strong>{" "}
              {syncResult.driver?.name}
            </p>

            <p>
              <strong>Ratings:</strong>{" "}
              {syncResult.ratingsInserted}
            </p>

            <p>
              <strong>Carros:</strong>{" "}
              {syncResult.carsSynced}
            </p>

            <p>
              <strong>Pistas:</strong>{" "}
              {syncResult.tracksSynced}
            </p>

            <p>
              <strong>Estatísticas:</strong>{" "}
              {syncResult.statisticsSynced}
            </p>
          </div>
        )}

        {syncResult?.status === "error" && (
          <div
            style={{
              marginTop: "28px",
              padding: "20px",
              background: "#30181b",
              borderRadius: "12px",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                color: "#ffb4bd",
              }}
            >
              Erro na sincronização
            </h2>

            <p>{syncResult.message}</p>
          </div>
        )}
      </div>
    </main>
  );
}
