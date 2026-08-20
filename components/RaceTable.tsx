'use client';

import React from 'react';

export interface Race {
  id?: number | string;
  // Suporta tanto a estrutura nova quanto a antiga
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
  return (
    <div className="table-responsive">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-sm">
            <th className="p-2">Data</th>
            <th className="p-2">Série / Carro</th>
            <th className="p-2">Pista</th>
            <th className="p-2">Largada</th>
            <th className="p-2">Chegada</th>
            <th className="p-2">Δ iRating</th>
          </tr>
        </thead>
        <tbody>
          {races.map((race, index) => {
            const dateVal = race.startedAt || race.date || '-';
            const startVal = race.startPosition ?? race.startPos ?? '-';
            const finishVal = race.finishPosition ?? race.finishPos ?? '-';
            const deltaVal = race.delta ?? race.iRatingChange ?? null;

            return (
              <tr key={race.id || index} className="border-b border-gray-800/50 hover:bg-gray-800/20 text-sm">
                <td className="p-2">{typeof dateVal === 'string' ? dateVal.split('T')[0] : dateVal}</td>
                <td className="p-2">
                  <div className="font-medium">{race.series || 'N/A'}</div>
                  <div className="text-xs text-gray-400">{race.car}</div>
                </td>
                <td className="p-2">{race.track}</td>
                <td className="p-2">{startVal !== null ? `P${startVal}` : '-'}</td>
                <td className="p-2">{finishVal !== null ? `P${finishVal}` : '-'}</td>
                <td className="p-2">
                  {deltaVal !== null ? (
                    <span className={deltaVal >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {deltaVal > 0 ? `+${deltaVal}` : deltaVal}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
