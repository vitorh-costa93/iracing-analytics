"use client";

import { useState } from "react";

type MainSyncResult = {
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

type LapsSyncResult = {
  status?: string;

  tracksFound?: number;
  tracksProcessed?: number;

  lapsReceived?: number;
  lapsSynced?: number;

  sectorsSynced?: number;

  telemetrySynced?: number;
  telemetrySkippedExisting?: number;
  telemetryFailed?: number;

  message?: string;
};

type FullSyncResult = {
  status: "ok" | "error";

  main?: MainSyncResult;
  laps?: LapsSyncResult;

  message?: string;
};

export default function Home() {
  const [syncing, setSyncing] = useState(false);

  const [syncStage, setSyncStage] =
    useState<string | null>(null);

  const [syncResult, setSyncResult] =
    useState<FullSyncResult | null>(null);

  async function syncAll() {
    setSyncing(true);
    setSyncResult(null);

    try {
      // ------------------------------------
      // ETAPA 1
      // Perfil + catálogo + estatísticas
      // ------------------------------------

      setSyncStage(
        "Sincronizando perfil, ratings, carros, pistas e estatísticas..."
      );

      const mainResponse = await fetch(
        "/api/sync/all",
        {
          method: "POST",
        }
      );

      const mainData: MainSyncResult =
        await mainResponse.json();

      if (
        !mainResponse.ok ||
        mainData.status !== "ok"
      ) {
        throw new Error(
          mainData.message ??
            "Erro na sincronização principal"
        );
      }

      // ------------------------------------
      // ETAPA 2
      // Laps + setores + telemetria
      // ------------------------------------

      setSyncStage(
        "Sincronizando voltas, setores e telemetria..."
      );

      const lapsResponse = await fetch(
        "/api/sync/laps-all",
        {
          method: "POST",
        }
      );

      const lapsData: LapsSyncResult =
        await lapsResponse.json();

      if (
        !lapsResponse.ok ||
        lapsData.status !== "ok"
      ) {
        throw new Error(
          lapsData.message ??
            "Erro na sincronização das voltas"
        );
      }

      // ------------------------------------
      // FINAL
      // ------------------------------------

      setSyncResult({
        status: "ok",
        main: mainData,
        laps: lapsData,
      });

      setSyncStage(null);
    } catch (error) {
      setSyncResult({
        status: "error",

        message:
          error instanceof Error
            ? error.message
            : "Erro desconhecido durante a sincronização",
      });

      setSyncStage(null);
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

          border:
            "1px solid #282d35",

          borderRadius: "18px",

          padding: "32px",
        }}
      >
        <small
          style={{
            color: "#8ab4d9",

            letterSpacing: "0.12em",

            fontWeight: 700,
          }}
        >
          IRACING ANALYTICS
        </small>

        <h1
          style={{
            fontSize: "48px",

            marginTop: "18px",

            marginBottom: "12px",
          }}
        >
          Racing Analytics
        </h1>

        <p
          style={{
            color: "#b8c0ca",

            lineHeight: 1.6,
          }}
        >
          Sincronize seus dados do Garage61
          com o Supabase.
        </p>

        <button
          onClick={syncAll}
          disabled={syncing}
          style={{
            marginTop: "22px",

            padding:
              "14px 22px",

            borderRadius:
              "10px",

            border: "none",

            cursor: syncing
              ? "not-allowed"
              : "pointer",

            fontWeight: 700,

            fontSize: "15px",

            background: syncing
              ? "#4b5563"
              : "#f4f5f7",

            color: syncing
              ? "#d1d5db"
              : "#0b0d10",
          }}
        >
          {syncing
            ? "Sincronizando..."
            : "Sincronizar tudo"}
        </button>

        {syncing && syncStage && (
          <div
            style={{
              marginTop: "22px",

              padding: "16px",

              borderRadius:
                "10px",

              background:
                "#17202b",

              color: "#a9c5df",
            }}
          >
            {syncStage}
          </div>
        )}

        {syncResult?.status ===
          "ok" && (
          <div
            style={{
              marginTop: "28px",

              padding: "24px",

              background:
                "#10301f",

              borderRadius:
                "14px",
            }}
          >
            <h2
              style={{
                marginTop: 0,

                color:
                  "#91e5ad",
              }}
            >
              ✓ Sincronização concluída
            </h2>

            <p>
              <strong>
                Piloto:
              </strong>{" "}
              {
                syncResult.main
                  ?.driver?.name
              }
            </p>

            <hr
              style={{
                border: 0,

                borderTop:
                  "1px solid #285039",

                margin:
                  "22px 0",
              }}
            />

            <h3>
              Dados gerais
            </h3>

            <p>
              <strong>
                Ratings:
              </strong>{" "}
              {
                syncResult.main
                  ?.ratingsInserted
              }
            </p>

            <p>
              <strong>
                Carros:
              </strong>{" "}
              {
                syncResult.main
                  ?.carsSynced
              }
            </p>

            <p>
              <strong>
                Pistas:
              </strong>{" "}
              {
                syncResult.main
                  ?.tracksSynced
              }
            </p>

            <p>
              <strong>
                Estatísticas:
              </strong>{" "}
              {
                syncResult.main
                  ?.statisticsSynced
              }
            </p>

            <hr
              style={{
                border: 0,

                borderTop:
                  "1px solid #285039",

                margin:
                  "22px 0",
              }}
            />

            <h3>
              Dados de pilotagem
            </h3>

            <p>
              <strong>
                Pistas utilizadas:
              </strong>{" "}
              {
                syncResult.laps
                  ?.tracksFound
              }
            </p>

            <p>
              <strong>
                Pistas processadas:
              </strong>{" "}
              {
                syncResult.laps
                  ?.tracksProcessed
              }
            </p>

            <p>
              <strong>
                Voltas:
              </strong>{" "}
              {
                syncResult.laps
                  ?.lapsSynced
              }
            </p>

            <p>
              <strong>
                Setores:
              </strong>{" "}
              {
                syncResult.laps
                  ?.sectorsSynced
              }
            </p>

            <hr
              style={{
                border: 0,

                borderTop:
                  "1px solid #285039",

                margin:
                  "22px 0",
              }}
            />

            <h3>
              Telemetria
            </h3>

            <p>
              <strong>
                Novas:
              </strong>{" "}
              {
                syncResult.laps
                  ?.telemetrySynced
              }
            </p>

            <p>
              <strong>
                Já existentes:
              </strong>{" "}
              {
                syncResult.laps
                  ?.telemetrySkippedExisting
              }
            </p>

            <p>
              <strong>
                Falhas:
              </strong>{" "}
              {
                syncResult.laps
                  ?.telemetryFailed
              }
            </p>
          </div>
        )}

        {syncResult?.status ===
          "error" && (
          <div
            style={{
              marginTop: "28px",

              padding: "20px",

              background:
                "#421b1e",

              borderRadius:
                "12px",
            }}
          >
            <h2
              style={{
                marginTop: 0,

                color:
                  "#ff9da4",
              }}
            >
              Erro na sincronização
            </h2>

            <p>
              {syncResult.message}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
