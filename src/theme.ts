/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zentrale Theme-Konstanten für das gesamte App-Design.
 * Tailwind-Klassen in JSX bleiben unverändert (JIT-Erzeugung).
 * Hier: Inline-Hex-Farben für SVG, Recharts, Canvas, Metrik-Konfigurationen.
 */

// --- Dark-Theme Palette (slate-basiert) ---
export const bg = {
  deepest: '#020617',
  darker: '#0f172a',
  dark: '#1e293b',
  mid: '#334155',
  light: '#475569',
  lightest: '#64748b',
} as const;

export const text = {
  bright: '#f8fafc',
  primary: '#f1f5f9',
  secondary: '#e2e8f0',
  muted: '#94a3b8',
  dim: '#64748b',
  veryDim: '#475569',
} as const;

export const border = {
  panel: '#334155',
  panelLight: '#475569',
  light: '#64748b',
} as const;

// --- Akzentfarben ---
export const accent = {
  indigo: '#6366f1',
  indigoLight: '#818cf8',
  indigoDark: '#4f46e5',
  emerald: '#10b981',
  emeraldLight: '#34d399',
  emeraldDark: '#059669',
  amber: '#f59e0b',
  amberLight: '#fbbf24',
  amberDark: '#d97706',
  rose: '#f43f5e',
  red: '#ef4444',
  blue: '#3b82f6',
  blueLight: '#60a5fa',
  sky: '#0ea5e9',
  cyan: '#06b6d4',
  violet: '#8b5cf6',
  pink: '#ec4899',
  purple: '#a855f7',
  orange: '#f97316',
} as const;

// --- Chart-Achsen & Gitter ---
export const chart = {
  grid: '#334155',
  axis: '#475569',
  axisLabel: '#64748b',
  axisText: '#94a3b8',
  referenceLine: '#64748b',
  zeroLine: '#ef4444',
  activeDot: '#60a5fa',
} as const;

// --- Common gradient definitions for SVG ---
export function makeGradient(id: string, color: string, opacity = 0.5) {
  return {
    id,
    color,
    top: color,
    bottom: color + '00',
    opacity,
  };
}

// --- Metrik-Konfiguration (für ProgressionChart & SessionComparison) ---
export interface MetricConfig {
  key: string;
  label: string;
  color: string;
  unit: string;
  referenceValue?: number;
  higherIsBetter?: boolean;
}

export const METRICS: MetricConfig[] = [
  { key: 'drift', label: 'Drift (ms)', color: '#0f172a', unit: 'ms', referenceValue: 0, higherIsBetter: false },
  { key: 'polyphony', label: 'Polyphonie', color: '#4f46e5', unit: '', referenceValue: undefined, higherIsBetter: true },
  { key: 'velocitySpread', label: 'Anschlagsdynamik', color: '#ec4899', unit: '', referenceValue: undefined, higherIsBetter: true },
  { key: 'pedalAccuracy', label: 'Pedal-Genauigkeit', color: '#06b6d4', unit: '%', referenceValue: 90, higherIsBetter: true },
];

// --- CalendarView Farben (pro Kategorie) ---
export const calendarCategoryColors = {
  lesson: {
    bg: 'bg-emerald-500',
    text: 'text-emerald-950',
    border: 'border-emerald-400',
    ring: 'ring-emerald-300',
    lightBg: 'bg-emerald-900/30',
    hex: '#10b981',
  },
  theory: {
    bg: 'bg-blue-500',
    text: 'text-blue-950',
    border: 'border-blue-400',
    ring: 'ring-blue-300',
    lightBg: 'bg-blue-900/30',
    hex: '#3b82f6',
  },
  practice: {
    bg: 'bg-amber-500',
    text: 'text-amber-950',
    border: 'border-amber-400',
    ring: 'ring-amber-300',
    lightBg: 'bg-amber-900/30',
    hex: '#f59e0b',
  },
  performance: {
    bg: 'bg-rose-500',
    text: 'text-rose-950',
    border: 'border-rose-400',
    ring: 'ring-rose-300',
    lightBg: 'bg-rose-900/30',
    hex: '#f43f5e',
  },
} as const;
