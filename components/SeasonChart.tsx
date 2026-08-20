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
  ChartOptions
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export interface WeekPoint {
  week: number;
  iRating?: number;
  irating?: number;
  val?: number;
  value?: number;
  [key: string]: any;
}

export interface SeasonChartProps {
  current: WeekPoint[];
  previous: WeekPoint[];
  currentName: string;
  previousName: string;
}

export default function SeasonChart({
  current = [],
  previous = [],
  currentName = 'Season Atual',
  previousName = 'Season Anterior'
}: SeasonChartProps) {
  const allWeeks = Array.from(
    new Set([...current.map((d) => d.week), ...previous.map((d) => d.week)])
  ).sort((a, b) => a - b);

  const labels = allWeeks.map((week) => `Semana ${week}`);

  const getValue = (item?: WeekPoint): number | null => {
    if (!item) return null;
    return item.iRating ?? item.irating ?? item.value ?? item.val ?? null;
  };

  const currentDataMap = new Map(current.map((item) => [item.week, getValue(item)]));
  const previousDataMap = new Map(previous.map((item) => [item.week, getValue(item)]));

  const data = {
    labels,
    datasets: [
      {
        label: currentName,
        data: allWeeks.map((week) => currentDataMap.get(week) ?? null),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        tension: 0.3,
        spanGaps: true,
      },
      {
        label: previousName,
        data: allWeeks.map((week) => previousDataMap.get(week) ?? null),
        borderColor: 'rgb(156, 163, 175)',
        backgroundColor: 'rgba(156, 163, 175, 0.5)',
        borderDash: [5, 5],
        tension: 0.3,
        spanGaps: true,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: { color: '#e5e7eb' },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#9ca3af' },
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#9ca3af' },
      },
    },
  };

  return (
    <div style={{ width: '100%', height: '350px' }}>
      <Line data={data} options={options} />
    </div>
  );
}
