'use client';

import React, { useState } from 'react';

export interface Race {
  id: string;
  date: string;
  track: string;
  car: string;
  startPos: number;
  finishPos: number;
  iRatingChange: number;
  incidents: number;
  sof: number;
}

interface RaceTableProps {
  races: Race[];
}

export default function RaceTable({ races = [] }: RaceTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  const totalPages = Math.ceil(races.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRaces = races.slice(startIndex, startIndex + pageSize);

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Season Races</h3>
          <p className="text-sm text-slate-500">Histórico detalhado de corridas da temporada</p>
        </div>
        <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
          Total: {races.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="py-3 px-4 text-sm font-semibold">Data</th>
              <th className="py-3 px-4 text-sm font-semibold">Pista</th>
              <th className="py-3 px-4 text-sm font-semibold">Carro</th>
              <th className="py-3 px-4 text-sm font-semibold text-center">Largada / Chegada</th>
              <th className="py-3 px-4 text-sm font-semibold text-center">iRating</th>
              <th className="py-3 px-4 text-sm font-semibold text-center">Incidentes</th>
              <th className="py-3 px-4 text-sm font-semibold text-center">SOF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedRaces.length > 0 ? (
              paginatedRaces.map((race) => (
                <tr key={race.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 text-sm text-slate-700">{race.date}</td>
                  <td className="py-3.5 px-4 text-sm font-semibold text-slate-800">{race.track}</td>
                  <td className="py-3.5 px-4 text-sm text-slate-600">{race.car}</td>
                  <td className="py-3.5 px-4 text-sm text-center font-medium">
                    P{race.startPos} → <span className="font-bold text-slate-900">P{race.finishPos}</span>
                  </td>
                  <td className="py-3.5 px-4 text-sm text-center font-bold">
                    <span className={race.iRatingChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {race.iRatingChange >= 0 ? `+${race.iRatingChange}` : race.iRatingChange}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-sm text-center text-slate-700 font-medium">
                    {race.incidents}x
                  </td>
                  <td className="py-3.5 px-4 text-sm text-center text-slate-500">
                    {race.sof}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400 text-sm">
                  Nenhuma corrida registrada nesta temporada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Controles de Paginação */}
      <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
        <span className="text-sm font-medium text-slate-600">
          Mostrando {races.length > 0 ? startIndex + 1 : 0} a {Math.min(startIndex + pageSize, races.length)} de {races.length} corridas
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="px-3.5 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Anterior
          </button>
          <span className="text-sm font-bold text-slate-700 px-2">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="px-3.5 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
