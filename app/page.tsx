"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type Rating = {
  value?: number | null;
  display?: string | null;
};

type RatingCategory = {
  irating?: Rating;
  safety_rating?: Rating;
};

type Activity = {
  month: string;
  events: number;
  laps: number;
  cleanLaps: number;
  seconds: number;
};

type PerformanceItem = {
  id: number;
  name: string;
  events: number;
  laps: number;
  cleanLaps: number;
  seconds: number;
};

type BestLap = {
  id: string;
  car: string;
  track: string;
  lapNumber?: number | null;
  lapTime: number;
  clean?: boolean | null;
  driverRating?: number | null;
  telemetryAvailable: boolean;
};

type DashboardData = {
  status: string;

  driver: {
    id: string;
    name: string;
    iracingId: string;
  };

  ratings: Record<
    string,
    RatingCategory
  >;

  totals: {
    events: number;
    laps: number;
    cleanLaps: number;
    cleanPercentage: number;
    timeOnTrackSeconds: number;
    drivenTracks: number;
    telemetryLaps: number;
  };

  activity: Activity[];

  topCars: PerformanceItem[];
  topTracks: PerformanceItem[];

  bestLaps: BestLap[];
};

function formatHours(seconds: number) {
  const hours = seconds / 3600;

  if (hours < 10) {
    return `${hours.toFixed(1)}h`;
  }

  return `${Math.round(hours)}h`;
}

function formatLapTime(
  seconds: number
) {
  const minutes = Math.floor(
    seconds / 60
  );

  const remaining =
    seconds - minutes * 60;

  return `${minutes}:${remaining
    .toFixed(3)
    .padStart(6, "0")}`;
}

function formatMonth(month: string) {
  const [year, m] =
    month.split("-");

  const names = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ];

  return `${names[
    Number(m) - 1
  ]}/${year.slice(2)}`;
}

function RatingCard({
  title,
  rating,
}: {
  title: string;
  rating?: RatingCategory;
}) {
  return (
    <div className="metric-card">
      <span className="metric-label">
        {title}
      </span>

      <strong className="metric-value">
        {rating?.irating?.display ??
          "—"}
      </strong>

      <span className="metric-subtitle">
        SR{" "}
        {rating?.safety_rating
          ?.display ?? "—"}
      </span>
    </div>
  );
}

export default function Home() {
  const [data, setData] =
    useState<DashboardData | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [syncing, setSyncing] =
    useState(false);

  const [message, setMessage] =
    useState<string | null>(null);

  const loadDashboard =
    useCallback(async () => {
      try {
        const response = await fetch(
          "/api/dashboard/overview",
          {
            cache: "no-store",
          }
        );

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.message ??
              "Erro ao carregar dashboard"
          );
        }

        setData(result);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Erro ao carregar dashboard"
        );
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function syncAll() {
    setSyncing(true);
    setMessage(
      "Sincronizando dados gerais..."
    );

    try {
      const mainResponse =
        await fetch(
          "/api/sync/all",
          {
            method: "POST",
          }
        );

      const main =
        await mainResponse.json();

      if (!mainResponse.ok) {
        throw new Error(
          main.message ??
            "Erro na sincronização geral"
        );
      }

      setMessage(
        "Sincronizando voltas e telemetria..."
      );

      const lapsResponse =
        await fetch(
          "/api/sync/laps-all",
          {
            method: "POST",
          }
        );

      const laps =
        await lapsResponse.json();

      if (!lapsResponse.ok) {
        throw new Error(
          laps.message ??
            "Erro ao sincronizar voltas"
        );
      }

      setMessage(
        `Sincronizado: ${laps.lapsSynced} voltas • ${laps.telemetrySynced} novas telemetrias`
      );

      await loadDashboard();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Erro na sincronização"
      );
    } finally {
      setSyncing(false);
    }
  }

  const maxActivityLaps =
    useMemo(() => {
      if (!data?.activity.length) {
        return 1;
      }

      return Math.max(
        ...data.activity.map(
          (item) => item.laps
        ),
        1
      );
    }, [data]);

  const maxCarLaps =
    useMemo(() => {
      if (!data?.topCars.length) {
        return 1;
      }

      return Math.max(
        ...data.topCars.map(
          (item) => item.laps
        ),
        1
      );
    }, [data]);

  const maxTrackLaps =
    useMemo(() => {
      if (!data?.topTracks.length) {
        return 1;
      }

      return Math.max(
        ...data.topTracks.map(
          (item) => item.laps
        ),
        1
      );
    }, [data]);

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div className="loading">
          Carregando Racing
          Analytics...
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="dashboard-shell">
        <div className="error-box">
          {message ??
            "Não foi possível carregar os dados."}
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              IRACING ANALYTICS
            </span>

            <h1>
              Racing Analytics
            </h1>

            <p>
              {data.driver.name} •
              iRacing #
              {data.driver.iracingId}
            </p>
          </div>

          <div className="sync-area">
            <button
              className="sync-button"
              onClick={syncAll}
              disabled={syncing}
            >
              {syncing
                ? "Sincronizando..."
                : "Sincronizar dados"}
            </button>

            {message && (
              <small>
                {message}
              </small>
            )}
          </div>
        </header>

        <section className="metrics-grid">
          <RatingCard
            title="Sports Car"
            rating={
              data.ratings[
                "sports_car"
              ]
            }
          />

          <RatingCard
            title="Formula Car"
            rating={
              data.ratings[
                "formula_car"
              ]
            }
          />

          <div className="metric-card">
            <span className="metric-label">
              Tempo em pista
            </span>

            <strong className="metric-value">
              {formatHours(
                data.totals
                  .timeOnTrackSeconds
              )}
            </strong>

            <span className="metric-subtitle">
              {data.totals.laps.toLocaleString(
                "pt-BR"
              )}{" "}
              voltas
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">
              Voltas limpas
            </span>

            <strong className="metric-value">
              {data.totals.cleanPercentage.toFixed(
                1
              )}
              %
            </strong>

            <span className="metric-subtitle">
              {data.totals.cleanLaps.toLocaleString(
                "pt-BR"
              )}{" "}
              de{" "}
              {data.totals.laps.toLocaleString(
                "pt-BR"
              )}
            </span>
          </div>
        </section>

        <section className="summary-strip">
          <div>
            <strong>
              {data.totals.events.toLocaleString(
                "pt-BR"
              )}
            </strong>
            <span>Eventos</span>
          </div>

          <div>
            <strong>
              {
                data.totals
                  .drivenTracks
              }
            </strong>
            <span>
              Pistas utilizadas
            </span>
          </div>

          <div>
            <strong>
              {
                data.totals
                  .telemetryLaps
              }
            </strong>
            <span>
              Telemetrias
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">
                ATIVIDADE
              </span>

              <h2>
                Últimos 12 meses
              </h2>
            </div>

            <span className="panel-note">
              Voltas por mês
            </span>
          </div>

          <div className="activity-chart">
            {data.activity.map(
              (item) => {
                const height =
                  Math.max(
                    4,
                    (item.laps /
                      maxActivityLaps) *
                      100
                  );

                return (
                  <div
                    className="activity-column"
                    key={item.month}
                  >
                    <div className="activity-value">
                      {item.laps}
                    </div>

                    <div className="activity-bar-track">
                      <div
                        className="activity-bar"
                        style={{
                          height: `${height}%`,
                        }}
                      />
                    </div>

                    <span>
                      {formatMonth(
                        item.month
                      )}
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </section>

        <section className="two-column">
          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">
                  CARROS
                </span>

                <h2>
                  Mais pilotados
                </h2>
              </div>
            </div>

            <div className="ranking-list">
              {data.topCars.map(
                (car) => (
                  <div
                    className="ranking-item"
                    key={car.id}
                  >
                    <div className="ranking-title">
                      <span>
                        {car.name}
                      </span>

                      <strong>
                        {car.laps} voltas
                      </strong>
                    </div>

                    <div className="ranking-track">
                      <div
                        className="ranking-fill"
                        style={{
                          width: `${
                            (car.laps /
                              maxCarLaps) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">
                  PISTAS
                </span>

                <h2>
                  Mais pilotadas
                </h2>
              </div>
            </div>

            <div className="ranking-list">
              {data.topTracks.map(
                (track) => (
                  <div
                    className="ranking-item"
                    key={track.id}
                  >
                    <div className="ranking-title">
                      <span>
                        {track.name}
                      </span>

                      <strong>
                        {track.laps} voltas
                      </strong>
                    </div>

                    <div className="ranking-track">
                      <div
                        className="ranking-fill"
                        style={{
                          width: `${
                            (track.laps /
                              maxTrackLaps) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">
                PERFORMANCE
              </span>

              <h2>
                Voltas disponíveis
              </h2>
            </div>

            <span className="panel-note">
              Garage61
            </span>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Pista</th>
                  <th>Carro</th>
                  <th>Tempo</th>
                  <th>iRating</th>
                  <th>Limpa</th>
                  <th>Telemetria</th>
                </tr>
              </thead>

              <tbody>
                {data.bestLaps.map(
                  (lap) => (
                    <tr key={lap.id}>
                      <td>
                        {lap.track}
                      </td>

                      <td>
                        {lap.car}
                      </td>

                      <td className="lap-time">
                        {formatLapTime(
                          lap.lapTime
                        )}
                      </td>

                      <td>
                        {lap.driverRating ??
                          "—"}
                      </td>

                      <td>
                        {lap.clean
                          ? "Sim"
                          : "Não"}
                      </td>

                      <td>
                        {lap.telemetryAvailable
                          ? "Disponível"
                          : "—"}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer>
          Dados fornecidos por
          Garage61.
        </footer>
      </div>
    </main>
  );
}
