'use client';

import React from 'react';

export interface Race {
  id?: number | string;
  date?: string;
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
  delta?: number | null;
  iRatingChange?: number | null;
  startPosition?: number | null;
  startPos?: number | null;
  finishPosition?: number | null;
  finishPos?: number | null;
  ratingCategory?: string | null;
  series?: string | null;
  car?: string;
  track?: string;
  bestLap?: number | null;
  [key: string]: any;
}

export interface RaceTableProps {
  races: Race[];
}

export default function RaceTable({ races = [] }: RaceTableProps) {
  const formatLapTime = (timeInSeconds: number | null) => {
    if (!timeInSeconds) return '-';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = (timeInSeconds % 60).toFixed(3);
    return minutes > 0 ? `${minutes}:${seconds.padStart(6, '0')}` : `${seconds}s`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      });
    } catch {
      return dateStr.split('T')[0] || dateStr;
    }
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <th className="py-3 px-4">Data</th>
            <th className="py-3 px-4">Série / Carro</th>
            <th className="py-3 px-4">Pista</th>
            <th className="py-3 px-4 text-center">Largada</th>
            <th className="py-3 px-4 text-center">Chegada</th>
            <th className="py-3 px-4 text-right">Melhor Volta</th>
            <th className="py-3 px-4 text-right">Δ iRating</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-sm">
          {races.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-gray-500">
                Nenhuma corrida encontrada na temporada.
              </td>
            </tr>
          ) : (
            races.map((race, index) => {
              const dateVal = formatDate(race.startedAt || race.date);
              const startVal = race.startPosition ?? race.startPos;
              const finishVal = race.finishPosition ?? race.finishPos;
              const deltaVal = race.delta ?? race.iRatingChange ?? null;

              return (
                <tr key={race.id || index} className="hover:bg-white/5 transition-colors">
                  <td className="py-3 px-4 whitespace-nowrap text-gray-300 font-mono text-xs">
                    {dateVal}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-white">{race.series || 'Série Desconhecida'}</div>
                    <div className="text-xs text-gray-400">{race.car || 'N/A'}</div>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{race.track || 'N/A'}</td>
                  <td className="py-3 px-4 text-center font-mono">
                    {startVal !== null && startVal !== undefined ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-white/5 text-gray-300 text-xs">
                        P{startVal}
                      </span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center font-mono">
                    {finishVal !== null && finishVal !== undefined ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-white/10 text-white font-semibold text-xs">
                        P{finishVal}
                      </span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-gray-300 text-xs">
                    {formatLapTime(race.bestLap ?? null)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold">
                    {deltaVal !== null && deltaVal !== undefined ? (
                      <span className={deltaVal >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                        {deltaVal > 0 ? `+${deltaVal}` : deltaVal}
                      </span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
