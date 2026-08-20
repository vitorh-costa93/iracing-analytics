'use client';

import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface SeasonChartProps {
  dataCurrent: number[];
  dataPrevious: number[];
  labels: string[];
}

export default function SeasonChart({ dataCurrent, dataPrevious, labels }: SeasonChartProps) {
  const data = {
    labels: labels && labels.length ? labels : ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
    datasets: [
      {
        label: '2026 S3',
        data: dataCurrent,
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.15)',
        fill: true,
        tension: 0.3,
        borderWidth: 3,
        pointRadius: 3,
      },
      {
        label: '2026 S2',
        data: dataPrevious,
        borderColor: '#94a3b8',
        borderDash: [5, 5],
        fill: false,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        align: 'end' as const,
        labels: {
          boxWidth: 12,
          usePointStyle: true,
          font: { size: 13, weight: 'bold' as const }
        }
      },
      tooltip: {
        padding: 10,
        titleFont: { size: 14 },
        bodyFont: { size: 13 }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 12 } }
      },
      y: {
        grid: { color: '#f1f5f9' },
        ticks: { font: { size: 12 } }
      }
    }
  };

  return (
    <div className="w-full bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-sky-600">iRating Evolution</span>
          <h2 className="text-xl font-bold text-slate-800">Evolução semanal</h2>
          <p className="text-sm text-slate-500">iRating absoluto por semana, comparando a Season atual com a anterior.</p>
        </div>
      </div>
      
      {/* Container ajustado para eliminar o espaço em branco no rodapé */}
      <div className="w-full h-72 relative">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
