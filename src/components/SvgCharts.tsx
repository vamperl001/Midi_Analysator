/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { MidiNote, AlsFileStats } from '../types';
import { chart as chartTheme, accent, text as textTheme, bg } from '../theme';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { Activity, Flame, Volume2, Music, Sparkles } from 'lucide-react';
import { CustomResponsiveContainer } from './CustomResponsiveContainer';

interface SvgChartsProps {
  data: AlsFileStats[];
  selectedNoteKey: number | null;
  setSelectedNoteKey: (key: number | null) => void;
}

// Hilfsmittel zum Übersetzen von MIDI-Key in Notennamen
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function getNoteName(key: number): string {
  const noteIndex = key % 12;
  const octave = Math.floor(key / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export const SvgCharts: React.FC<SvgChartsProps> = ({ data, selectedNoteKey, setSelectedNoteKey }) => {
  // Live Hover-Zustand für das 16tel Grid (Anschlagsstärke / Drift)
  const [heatmapMode, setHeatmapMode] = useState<'velocity' | 'drift'>('velocity');
  const [hoveredCell, setHoveredCell] = useState<{ step: number; beat: number; sub: string; avgVel: number; count: number; avgDrift: number } | null>(null);

  // --- 1. DATEN EXTRAHIEREN ---
  const allNotes = useMemo(() => {
    return data.flatMap(session => 
      session.notes.map(note => ({
        ...note,
        sessionDate: session.date,
        sessionTempo: session.tempo,
        sessionName: session.fileName
      }))
    );
  }, [data]);

  // Für die Histogramm-Berechnung filtern wir ggf. nach der ausgewählten Note (Piano Roll)
  const filteredNotesForHistogram = useMemo(() => {
    if (selectedNoteKey === null) return allNotes;
    return allNotes.filter(n => n.key === selectedNoteKey);
  }, [allNotes, selectedNoteKey]);

  // --- 2. STATISTIKEN BERECHNEN ---
  const stats = useMemo(() => {
    const notesCount = filteredNotesForHistogram.length;
    if (notesCount === 0) return { avg: 0, std: 0, earlyPercent: 50, latePercent: 50, median: 0 };

    const offsets = filteredNotesForHistogram.map(n => n.gridOffsetMs);
    const sum = offsets.reduce((s, val) => s + val, 0);
    const avg = sum / notesCount;
    
    // Standardabweichung
    const variance = offsets.reduce((s, val) => s + Math.pow(val - avg, 2), 0) / notesCount;
    const std = Math.sqrt(variance);

    // Median
    const sorted = [...offsets].sort((a, b) => a - b);
    const median = sorted[Math.floor(notesCount / 2)];

    // Early vs Late
    const early = offsets.filter(o => o < -1.5).length; // Größer als 1.5ms Toleranz vor dem Grid
    const late = offsets.filter(o => o > 1.5).length; // Größer als 1.5ms Toleranz hinter dem Grid
    const tight = notesCount - early - late;

    const earlyPercent = Math.round((early / notesCount) * 100);
    const latePercent = Math.round((late / notesCount) * 100);
    const tightPercent = 100 - earlyPercent - latePercent;

    return { avg, std, earlyPercent, latePercent, tightPercent, median };
  }, [filteredNotesForHistogram]);

  // --- 3. HISTOGRAMM BINS ERSTELLEN (-60ms bis +60ms) ---
  const histogramBins = useMemo(() => {
    const minMs = -50;
    const maxMs = 50;
    const binSize = 2; // 2ms pro Balken
    const numBins = Math.ceil((maxMs - minMs) / binSize);
    
    const bins = Array.from({ length: numBins }, (_, idx) => {
      const lower = minMs + idx * binSize;
      const upper = lower + binSize;
      return {
        label: `${lower} bis ${upper}ms`,
        lower,
        upper,
        mid: lower + binSize / 2,
        count: 0
      };
    });

    const activeOffsets = filteredNotesForHistogram.map(n => n.gridOffsetMs);
    activeOffsets.forEach(offset => {
      for (const bin of bins) {
        if (offset >= bin.lower && offset < bin.upper) {
          bin.count++;
          break;
        }
      }
    });

    return bins;
  }, [filteredNotesForHistogram]);

  const maxBinCount = useMemo(() => {
    const counts = histogramBins.map(b => b.count);
    return counts.length > 0 ? counts.reduce((a, b) => Math.max(a, b), 1) : 1;
  }, [histogramBins]);

  // --- 4. DAILY TREND BERECHNEN ---
  const dailyTrend = useMemo(() => {
    // Sortiere nach Datum
    const sortedSessions = [...data].sort((a, b) => a.date.localeCompare(b.date));
    
    // Gruppiere nach Datum für den Fall mehrfacher Dateien pro Tag
    const grouped: { [date: string]: { totalDrift: number, totalTempo: number, count: number, totalSwing: number } } = {};
    sortedSessions.forEach(s => {
      if (!grouped[s.date]) {
         grouped[s.date] = { totalDrift: 0, totalTempo: 0, count: 0, totalSwing: 0 };
      }
      grouped[s.date].totalDrift += s.avgDriftMs;
      grouped[s.date].totalTempo += s.tempo;
      grouped[s.date].totalSwing += s.swingFactor16th;
      grouped[s.date].count += 1;
    });

    const timelineData = Object.entries(grouped).map(([date, obj]) => {
      return {
        date,
        avgDrift: parseFloat((obj.totalDrift / obj.count).toFixed(2)),
        avgTempo: parseFloat((obj.totalTempo / obj.count).toFixed(1)),
        avgSwing: parseFloat((obj.totalSwing / obj.count).toFixed(1)),
        displayDate: new Date(date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
      };
    });

    // 7-Tage-Gleitender-Durchschnitt hinzufügen
    return timelineData.map((day, idx, arr) => {
      const start = Math.max(0, idx - 6);
      const windowItems = arr.slice(start, idx + 1);
      const sumDrift = windowItems.reduce((acc, item) => acc + item.avgDrift, 0);
      const sumSwing = windowItems.reduce((acc, item) => acc + item.avgSwing, 0);
      
      return {
        ...day,
        rollingDrift: parseFloat((sumDrift / windowItems.length).toFixed(2)),
        rollingSwing: parseFloat((sumSwing / windowItems.length).toFixed(2))
      };
    });
  }, [data]);

  // Trenddimensionen für SVG definieren
  const trendMaxDrift = useMemo(() => {
    const vals = dailyTrend.map(d => Math.max(d.avgDrift, d.rollingDrift || 0));
    return vals.length > 0 ? vals.reduce((a, b) => Math.max(a, b), 15) : 25;
  }, [dailyTrend]);

  const trendMinDrift = useMemo(() => {
    const vals = dailyTrend.map(d => Math.min(d.avgDrift, d.rollingDrift || 0));
    return vals.length > 0 ? Math.max(0, vals.reduce((a, b) => Math.min(a, b), vals[0])) : 0;
  }, [dailyTrend]);

  // --- 5. SWING FACTOR DISTRIBUTION ---
  const swingDistribution = useMemo(() => {
    const swings = data.map(s => s.swingFactor16th).filter(s => s > 40 && s < 80);
    const buckets = Array.from({ length: 16 }, (_, i) => 48 + i * 1.5); // 48% bis 72%
    const counts = buckets.map(upper => {
      const lower = upper - 1.5;
      const cnt = swings.filter(s => s >= lower && s < upper).length;
      return { label: `${lower.toFixed(1)}%`, count: cnt, mid: lower + 0.75 };
    });
    return counts;
  }, [data]);

  const maxSwingCount = useMemo(() => {
    const counts = swingDistribution.map(s => s.count);
    return counts.length > 0 ? counts.reduce((a, b) => Math.max(a, b), 1) : 1;
  }, [swingDistribution]);

  // --- 6. PIANO KEYS HEATMAP ---
  const pianoNotesStatus = useMemo(() => {
    const counts: { [key: number]: number } = {};
    for (let k = 36; k <= 84; k++) counts[k] = 0; // Standard 4 Oktaven

    allNotes.forEach(n => {
      if (counts[n.key] !== undefined) {
        counts[n.key]++;
      }
    });

    const maxCount = Math.max(Object.values(counts).reduce((a, b) => Math.max(a, b), 1), 1);
    
    return Object.entries(counts).map(([keyStr, cnt]) => {
      const key = parseInt(keyStr);
      const isBlack = [1, 3, 6, 8, 10].includes(key % 12);
      return {
        key,
        name: getNoteName(key),
        count: cnt,
        intensity: cnt / maxCount,
        isBlack
      };
    });
  }, [allNotes]);

  // Detailanzeige für die ausgewählte Note im Piano Roll
  const selectedNoteInfo = useMemo(() => {
    if (selectedNoteKey === null) return null;
    const notesForKey = allNotes.filter(n => n.key === selectedNoteKey);
    if (notesForKey.length === 0) return null;

    const avgDrift = notesForKey.reduce((acc, curr) => acc + curr.gridOffsetMs, 0) / notesForKey.length;
    const absDrift = notesForKey.reduce((acc, curr) => acc + Math.abs(curr.gridOffsetMs), 0) / notesForKey.length;
    const avgVelocity = notesForKey.reduce((acc, curr) => acc + curr.velocity, 0) / notesForKey.length;

    return {
      noteName: getNoteName(selectedNoteKey),
      count: notesForKey.length,
      avgDriftMs: avgDrift.toFixed(1),
      absDriftMs: absDrift.toFixed(1),
      avgVelocity: Math.round(avgVelocity)
    };
  }, [allNotes, selectedNoteKey]);

  // --- 7. NOTENDICHTE BERECHNEN (Noten pro Takt über die Zeitachse) ---
  const noteDensityData = useMemo(() => {
    if (allNotes.length === 0) return [];
    
    // Finde das maximale Timing der aktuellen Session(s) vor
    const times = allNotes.map(n => n.time);
    const maxBeat = times.length > 0 ? times.reduce((a, b) => Math.max(a, b), 1) : 1;
    const numBars = Math.ceil(maxBeat / 4);
    
    // Initialisiere die Takte von 1 bis numBars (Sicherung bei maximal 256 Takten für gute Chartdarstellung)
    const barsCount = Math.min(numBars, 256);
    const bars = Array.from({ length: barsCount }, (_, i) => ({
      barNum: i + 1,
      notesCount: 0,
      totalVelocity: 0,
    }));
    
    allNotes.forEach(note => {
      const barIdx = Math.floor(note.time / 4);
      if (barIdx >= 0 && barIdx < barsCount) {
        bars[barIdx].notesCount += 1;
        bars[barIdx].totalVelocity += note.velocity;
      }
    });
    
    return bars.map(b => ({
      ...b,
      avgVelocity: b.notesCount > 0 ? Math.round(b.totalVelocity / b.notesCount) : 0
    }));
  }, [allNotes]);

  // Statistik für Notendichte (Zell-KPIs)
  const noteDensityStats = useMemo(() => {
    if (noteDensityData.length === 0) return { max: 0, avg: 0, totalBars: 0 };
    const counts = noteDensityData.map(b => b.notesCount);
    const max = counts.length > 0 ? counts.reduce((a, b) => Math.max(a, b), 0) : 0;
    const sum = counts.reduce((acc, c) => acc + c, 0);
    const avg = sum / noteDensityData.length;
    return {
      max,
      avg: parseFloat(avg.toFixed(1)),
      totalBars: noteDensityData.length
    };
  }, [noteDensityData]);

  // --- 8. DURCHSCHNITTLICHE VELOCITY IM 16TEL-RASTER BERECHNEN (HEATMAP) ---
  const velocityHeatmapData = useMemo(() => {
    // Initialisiere 16 Buckets für die 16tel Noten eines Taktes (Beat 1-4, Subdivisions 1, e, +, d)
    const grid = Array.from({ length: 16 }, (_, step) => ({
      step,
      colIndex: Math.floor(step / 4), // Beat 1 bis 4 (0 to 3)
      rowIndex: step % 4, // subdivisions 0 to 3
      sumVelocity: 0,
      noteCount: 0,
    }));

    allNotes.forEach(note => {
      // Position im Takt aus roher Zeit (nicht aus nearestGrid, das vom dynamischen Grid abhängt)
      const posInBar = note.time % 4;
      const step = Math.round(posInBar * 4) % 16;
      if (step >= 0 && step < 16) {
        grid[step].sumVelocity += note.velocity;
        grid[step].noteCount += 1;
      }
    });

    return grid.map(g => ({
      ...g,
      avgVelocity: g.noteCount > 0 ? Math.round(g.sumVelocity / g.noteCount) : 0,
    }));
  }, [allNotes]);

  // --- 8B. DURCHSCHNITTLICHES TIMING DRIFT IM 16TEL-RASTER BERECHNEN (HEATMAP) ---
  const driftHeatmapData = useMemo(() => {
    // Initialisiere 16 Buckets für die 16tel Noten eines Taktes
    const grid = Array.from({ length: 16 }, (_, step) => ({
      step,
      colIndex: Math.floor(step / 4),
      rowIndex: step % 4,
      sumDrift: 0,
      noteCount: 0,
    }));

    allNotes.forEach(note => {
      const posInBar = note.time % 4;
      const step = Math.round(posInBar * 4) % 16;
      if (step >= 0 && step < 16) {
        grid[step].sumDrift += note.gridOffsetMs;
        grid[step].noteCount += 1;
      }
    });

    return grid.map(g => ({
      ...g,
      avgDrift: g.noteCount > 0 ? parseFloat((g.sumDrift / g.noteCount).toFixed(1)) : 0,
    }));
  }, [allNotes]);

  // Heatmap-Statistik (Ampli-Hüllkurven Profiling)
  const heatmapStats = useMemo(() => {
    const activeSteps = velocityHeatmapData.filter(s => s.noteCount > 0);
    if (activeSteps.length === 0) return { min: 0, max: 0, dynamicDelta: 0, accentuation: "Homogen" };
    
    const vels = activeSteps.map(s => s.avgVelocity);
    const min = vels.reduce((a, b) => Math.min(a, b), vels[0]);
    const max = vels.reduce((a, b) => Math.max(a, b), vels[0]);
    const dynamicDelta = max - min;
    
    let accentuation = "Homogen";
    if (dynamicDelta > 30) {
      accentuation = "Hochexpressiv";
    } else if (dynamicDelta > 12) {
      accentuation = "Mittel-Akzentuiert";
    }

    return { min, max, dynamicDelta, accentuation };
  }, [velocityHeatmapData]);

  return (
    <div className="space-y-6 animate-fade-in" id="svg-charts-dashboard-section">
      {/* Obere Reihe: Standard-Diagramme */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="svg-charts-container">
      
      {/* 1. TIMING DRIFT HISTOGRAMM */}
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-drift-histogram">
        <div className="mb-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono">
              ★ Microtiming-Drift-Verteilung
            </h3>
            {selectedNoteKey !== null && (
              <button 
                onClick={() => setSelectedNoteKey(null)}
                className="text-xs text-blue-600 hover:text-blue-800 font-mono flex items-center gap-1"
              >
                ◀ Clear Filter ({getNoteName(selectedNoteKey)})
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1 italic font-serif">
            {selectedNoteKey === null 
              ? 'Wahre Abweichung aller MIDI-Noten von der quantisierten Grid-Sollzeit.' 
              : `Spezifischer Drift für Note ${getNoteName(selectedNoteKey)}.`}
          </p>
        </div>

        {/* Die SVG Grafik */}
        <div className="relative flex-1 min-h-[220px] bg-slate-800/40 p-4 rounded border border-slate-700/50 flex flex-col justify-end">
          <svg className="w-full h-44 overflow-visible" viewBox="0 0 300 120" preserveAspectRatio="none">
              {/* Grid Linien */}
              <line x1="150" y1="0" x2="150" y2="110" stroke={chartTheme.zeroLine} strokeDasharray="3,2" strokeWidth="1" />
              <line x1="50" y1="0" x2="50" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />
              <line x1="100" y1="0" x2="100" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />
              <line x1="200" y1="0" x2="200" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />
              <line x1="250" y1="0" x2="250" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />

            {/* Balken zeichnen */}
            {histogramBins.map((bin, idx) => {
              const x = (idx / histogramBins.length) * 300;
              const barHeight = (bin.count / maxBinCount) * 100;
              const y = 110 - barHeight;
              
              // Farbcodierung: Clean Minimalism theme (blue und light/slate grey)
              const distanceToCenter = Math.abs(bin.mid);
              let barColor: string = accent.blue; // Minimal Blue for tight notes
              if (distanceToCenter < 6) {
                barColor = bg.dark; // Deep Indigo/Black for super on-grid timing
              } else if (distanceToCenter > 22) {
                barColor = textTheme.muted; // Soft slate-gray for wide timing
              }

              return (
                <rect 
                  key={idx}
                  x={x}
                  y={y}
                  width={Math.max(0.5, 300 / histogramBins.length - 0.5)}
                  height={barHeight}
                  fill={barColor}
                  className="transition-all duration-300 hover:fill-blue-600 cursor-pointer"
                >
                  <title>{`${bin.lower} bis ${bin.upper} ms: ${bin.count} Noten`}</title>
                </rect>
              );
            })}

            {/* Nullstellenlinie Text */}
            <text x="153" y="12" fill={accent.red} fontSize="7" fontFamily="monospace" fontWeight="bold">Grid-Soll (0ms)</text>
          </svg>
          
          {/* X Achsenbeschriftung */}
          <div className="flex justify-between mt-2 px-1 text-[9px] font-mono text-slate-400">
            <span>-50ms (Früh)</span>
            <span>0ms</span>
            <span>+50ms (Spät)</span>
          </div>
        </div>

        {/* Statistiken */}
        <div className="grid grid-cols-3 gap-2 mt-4 text-center font-mono">
          <div className="bg-slate-800/40 p-2.5 rounded border border-slate-700/50">
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">MEDIAN</div>
            <div className={`text-xs font-bold ${Math.abs(stats.median) < 4 ? 'text-slate-100' : 'text-blue-400'}`}>
              {stats.median > 0 ? `+${stats.median.toFixed(1)}` : stats.median.toFixed(1)} <span className="text-[8px] font-light">ms</span>
            </div>
          </div>
          <div className="bg-slate-800/40 p-2.5 rounded border border-slate-700/50">
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">Jitter (STD)</div>
            <div className="text-xs font-bold text-slate-100">
              {stats.std.toFixed(1)} <span className="text-[8px] font-light">ms</span>
            </div>
          </div>
          <div className="bg-slate-800/40 p-2.5 rounded border border-slate-700/50">
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">Early/Late</div>
            <div className="text-[10px] font-bold text-slate-300 mt-0.5">
              -{stats.earlyPercent}% | +{stats.latePercent}%
            </div>
          </div>
        </div>

        {/* Kurze Erklärung des Timings */}
        <div className="mt-4 text-xs text-slate-400 leading-snug flex-1 bg-slate-800/40 p-3 rounded border border-slate-700/50 font-mono">
          {Math.abs(stats.avg) < 3 && stats.std < 12 ? (
            <span className="text-emerald-400">✔ Äußerst tightes Timing! Minimale Abweichung, maschinell präzise eingespielt.</span>
          ) : stats.median > 6 ? (
            <span className="text-slate-300">⚡ Timing-Tendenzen laid-back (behind the beat). Ergibt einen entspannten, ziehenden Musikgroove.</span>
          ) : stats.median < -6 ? (
            <span className="text-slate-300">⚡ Timing treibend (ahead of the beat). Erzeugt nervösen Drive für mehr Vorwärtsdrang.</span>
          ) : (
            <span className="text-slate-300">Natürlicher rhythmischer Rhythmus mit organischen Schwankungen.</span>
          )}
        </div>
      </div>

      {/* 2. DAILY TREND (6-MONATS-TREND) */}
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-drift-trend">
        <div className="mb-4">
          <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono">
            📈 Drift & Swing 6-Monats-Trend
          </h3>
          <p className="text-xs text-slate-400 mt-1 italic font-serif">
            Zeitlicher Verlauf von mittlerer Abweichung (schwarz) & Swing-Stabilität (blau).
          </p>
        </div>

        {dailyTrend.length === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-slate-800/40 rounded border border-slate-700/50 p-5 text-slate-400 text-xs font-mono h-[220px]">
            Keine Trend-Daten vorhanden. Bitte laden Sie Demo-Daten.
          </div>
        ) : (
          <div className="relative flex-1 min-h-[220px] bg-slate-800/40 p-4 rounded border border-slate-700/50 flex flex-col justify-end">
            <svg className="w-full h-44 overflow-visible" viewBox="0 0 300 120" preserveAspectRatio="none">
              {/* Grid Linien horizontal */}
              <line x1="0" y1="30" x2="300" y2="30" stroke={chartTheme.axis} strokeWidth="0.5" strokeDasharray="2,2" />
              <line x1="0" y1="60" x2="300" y2="60" stroke={chartTheme.axis} strokeWidth="0.5" strokeDasharray="2,2" />
              <line x1="0" y1="90" x2="300" y2="90" stroke={chartTheme.axis} strokeWidth="0.5" strokeDasharray="2,2" />

              {/* Verlauf 1: Drift (Schwarze schattierte Kurve) */}
              {(() => {
                const points = dailyTrend.map((d, idx) => {
                  const x = dailyTrend.length > 1 ? (idx / (dailyTrend.length - 1)) * 300 : 150;
                  const heightRange = trendMaxDrift - trendMinDrift;
                  const ratio = heightRange > 0 ? (d.avgDrift - trendMinDrift) / heightRange : 0.5;
                  const y = 110 - (ratio * 80);
                  return `${x},${y}`;
                });

                const rollingPoints = dailyTrend.map((d, idx) => {
                  const x = dailyTrend.length > 1 ? (idx / (dailyTrend.length - 1)) * 300 : 150;
                  const heightRange = trendMaxDrift - trendMinDrift;
                  const ratio = heightRange > 0 ? (d.rollingDrift - trendMinDrift) / heightRange : 0.5;
                  const y = 110 - (ratio * 80);
                  return `${x},${y}`;
                });

                const areaPoints = [
                  `0,110`,
                  ...points,
                  `300,110`
                ].join(" ");

                return (
                  <>
                    {/* Gefüllter Bereich */}
                    <polygon points={areaPoints} fill="url(#slateGradient)" opacity="0.10" />
                    
                    {/* Tägliche Knoten */}
                    {dailyTrend.length < 50 && dailyTrend.map((d, idx) => {
                      const coord = points[idx].split(",");
                      return <circle key={idx} cx={coord[0]} cy={coord[1]} r="2" fill={textTheme.muted} opacity="0.4" />;
                    })}

                    {/* Glatte Trend-Linie */}
                    <polyline 
                      points={rollingPoints.join(" ")} 
                      fill="none" 
                      stroke={textTheme.bright} 
                      strokeWidth="2" 
                    />
                  </>
                );
              })()}

              {/* Verlauf 2: Swing-Faktor (Blaue gestrichelte Linie) */}
              {(() => {
                const pointsSwing = dailyTrend.map((d, idx) => {
                  const x = dailyTrend.length > 1 ? (idx / (dailyTrend.length - 1)) * 300 : 150;
                  const ratio = (d.rollingSwing - 50) / 15;
                  const clampedRatio = Math.max(0, Math.min(1, ratio));
                  const y = 110 - (clampedRatio * 80);
                  return `${x},${y}`;
                });

                return (
                  <polyline 
                    points={pointsSwing.join(" ")} 
                    fill="none" 
                    stroke={accent.blue} 
                    strokeWidth="1.5" 
                    strokeDasharray="4,2" 
                  />
                );
              })()}

              {/* Gradients definieren */}
              <defs>
                <linearGradient id="slateGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={textTheme.bright} />
                  <stop offset="100%" stopColor={textTheme.bright} stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Legende und Achsenbeschriftung */}
            <div className="flex justify-between items-center mt-2 px-1 text-[9px] font-mono text-slate-400">
              <span>Januar</span>
              <span>März</span>
              <span>Juni</span>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row justify-between items-baseline bg-slate-800/40 p-4 rounded border border-slate-700/50 font-mono text-xs gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-slate-900 rounded-full inline-block"></span>
            <div>
              <div className="text-[9px] text-slate-500">MESSDRFT</div>
              <div className="font-bold text-slate-850">
                {dailyTrend.length > 0 ? dailyTrend[dailyTrend.length - 1].rollingDrift.toFixed(1) : 0} ms
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-500 rounded-full inline-block"></span>
            <div>
              <div className="text-[9px] text-slate-500">SWING 16TEL</div>
              <div className="font-bold text-blue-600">
                {dailyTrend.length > 0 ? dailyTrend[dailyTrend.length - 1].rollingSwing.toFixed(1) : 50.0}%
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 max-w-[120px] sm:text-right leading-tight">
            Swing-Entwicklung über das Halbjahr.
          </p>
        </div>
      </div>

      {/* 3. INTERAKTIV PIANO ROLL KEY HEATMAP */}
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-piano-roll">
        <div className="mb-4">
          <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono">
            🎹 Tonleiter-Verteilung & Timing-Zoom
          </h3>
          <p className="text-xs text-slate-400 mt-1 italic font-serif">
            Isoliere spezifische Tonschichten um deren spezifischen Groove zu entlarven.
          </p>
        </div>

        {/* Virtuelles Piano Roll */}
        <div className="flex-1 bg-slate-950 rounded border border-slate-700/50 p-3 overflow-y-auto max-h-[220px] flex gap-3">
          
          {/* Piano Keyboard */}
          <div className="w-1/2 flex flex-col border-r border-slate-700/50 pr-2">
            {pianoNotesStatus.slice(0, 24).map((item) => {
              const isSelected = selectedNoteKey === item.key;
              
              let bgStyle = "bg-white text-slate-800 border-slate-200";
              if (item.isBlack) {
                bgStyle = "bg-slate-900 text-slate-300 border-slate-800";
              }
              
              if (item.count > 0) {
                bgStyle = item.isBlack 
                  ? "bg-blue-900/90 text-blue-100 border-blue-950" 
                  : "bg-blue-50 text-blue-900 border-blue-200";
              }
              if (isSelected) {
                bgStyle = "bg-slate-800 text-white font-bold border-slate-950 ring-1 ring-slate-900";
              }

              return (
                <button
                  key={item.key}
                  id={`piano-key-${item.key}`}
                  onClick={() => setSelectedNoteKey(isSelected ? null : item.key)}
                  className={`flex justify-between items-center h-5 w-full text-[9px] font-mono px-2 py-0.5 border-b rounded-sm cursor-pointer transition-all ${bgStyle}`}
                >
                  <span>{item.name}</span>
                  <span className="opacity-80 text-[8px] font-semibold">{item.count > 0 ? `${item.count}n` : ''}</span>
                </button>
              );
            })}
          </div>

          {/* Zoom Info Panel */}
          <div className="w-1/2 flex flex-col justify-between p-3 rounded bg-slate-900/80 border border-slate-700/50 font-mono text-[10px]" id="piano-key-detail">
            {selectedNoteInfo ? (
              <div className="flex flex-col gap-1.5">
                <div className="text-slate-100 font-bold text-center border-b border-slate-700/50 pb-1 flex justify-between items-center text-[11px]">
                  <span>Note {selectedNoteInfo.noteName}</span>
                  <span className="text-[8px] text-slate-400 font-normal">MIDI {selectedNoteKey}</span>
                </div>
                
                <div className="flex justify-between items-center py-1 border-b border-slate-700/30">
                  <span className="text-slate-400">Events:</span>
                  <span className="text-slate-100 font-medium">{selectedNoteInfo.count}</span>
                </div>
                
                <div className="flex justify-between items-center py-1 border-b border-slate-700/30">
                  <span className="text-slate-400">Trend:</span>
                  <span className={`font-medium ${parseFloat(selectedNoteInfo.avgDriftMs) > 0 ? 'text-blue-400' : 'text-slate-100'}`}>
                    {parseFloat(selectedNoteInfo.avgDriftMs) > 0 ? 'Laid-back' : 'Ahead'} ({selectedNoteInfo.avgDriftMs}ms)
                  </span>
                </div>

                <div className="flex justify-between items-center py-1 border-b border-slate-700/30">
                  <span className="text-slate-400">Fehler ø:</span>
                  <span className="text-slate-100 font-medium">{selectedNoteInfo.absDriftMs} ms</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Anschlag:</span>
                  <span className="text-blue-400 font-medium">{selectedNoteInfo.avgVelocity}</span>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col justify-center items-center text-center text-slate-400 p-1 leading-relaxed">
                <p className="text-[10px]">Wähle links eine Keyboard-Taste.</p>
                <p className="text-[8px] mt-1.5 opacity-80 font-sans italic">Jede Note wird isoliert angezeigt.</p>
              </div>
            )}
            
            {selectedNoteInfo && (
              <button 
                onClick={() => setSelectedNoteKey(null)}
                className="mt-3 text-[9px] text-center bg-slate-700 hover:bg-slate-600 text-slate-200 py-1 px-2 rounded border border-slate-600 transition-colors cursor-pointer font-sans"
              >
                Zurücksetzen
              </button>
            )}
          </div>

        </div>

        <div className="mt-4 p-2.5 bg-slate-800/60 border border-slate-600 rounded text-slate-300 text-[10px] font-mono flex items-start gap-2">
          <span>💡</span>
          <span>Tiefe Noten (C2–C3) zeigen oft einen stabileren Groove als hohe Lagen.</span>
        </div>
      </div>

    </div>

      {/* Untere Reihe: Neue Notendichte Line/Area-Grafik & Anschlagsstärke Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="svg-new-charts-container">
        
        {/* A. Notendichte Liniendiagramm */}
        <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-note-density">
          <div className="mb-4">
              <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono flex items-center gap-1.5">
               <Activity className="w-4 h-4 text-slate-100" />
               📈 Musikalische Intensität (Notendichte)
            </h3>
            <p className="text-xs text-slate-400 mt-1 italic font-serif">
              Anzahl der gespielten Noten pro Takt über die Zeitachse, um Spannungsverläufe und dramatische Höhepunkte der Session zu verfolgen.
            </p>
          </div>

          {noteDensityData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center bg-slate-800/40 rounded border border-slate-700/50 p-5 text-slate-400 text-xs font-mono h-[220px]">
              Keine Noten für Intensitätsanalyse vorhanden.
            </div>
          ) : (
            <div className="flex-1 min-h-[220px] bg-slate-800/40 p-4 rounded border border-slate-700/50 flex flex-col justify-between">
              <div className="h-44 w-full">
                <CustomResponsiveContainer>
                  {(width, height) => (
                    <AreaChart
                      width={width}
                      height={height}
                      data={noteDensityData}
                      margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="densityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={textTheme.bright} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={textTheme.bright} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis 
                        dataKey="barNum" 
                        tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'monospace' }}
                        axisLine={{ stroke: '#475569' }}
                        tickLine={false}
                        label={{ value: 'Takt', position: 'insideBottomRight', offset: -5, fill: '#64748b', fontSize: 8, fontFamily: 'monospace' }}
                      />
                      <YAxis 
                        tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'monospace' }}
                        axisLine={{ stroke: '#475569' }}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="bg-slate-900 text-white rounded p-2.5 shadow-lg border border-slate-800 font-mono text-[10px] space-y-1">
                                <div className="font-bold text-slate-400 border-b border-slate-800 pb-1">TAKT-DETAILS</div>
                                <div>Taktnummer: <span className="text-white font-bold">#{d.barNum}</span></div>
                                <div className="flex justify-between gap-4 mt-0.5">
                                  <span className="text-slate-300">Notenanzahl:</span>
                                  <span className="text-blue-300 font-bold">{d.notesCount} Notes</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span className="text-slate-300">ø Velocity:</span>
                                  <span className="text-amber-300 font-bold">{d.avgVelocity} (0-127)</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="notesCount"
                        stroke={textTheme.bright}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#densityGrad)"
                        activeDot={{ r: 5, fill: chartTheme.activeDot, stroke: bg.dark, strokeWidth: 1.5 }}
                      />
                    </AreaChart>
                  )}
                </CustomResponsiveContainer>
              </div>

              {/* Quick KPIs */}
              <div className="grid grid-cols-3 gap-2 mt-4 text-center font-mono text-[10px]">
                <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
                  <div className="text-[8px] text-slate-400 uppercase font-black">Spitzen-Dichte</div>
                  <div className="text-[11px] font-bold text-slate-100 mt-0.5">{noteDensityStats.max} <span className="text-[8px] font-normal text-slate-400">Noten</span></div>
                </div>
                <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
                  <div className="text-[8px] text-slate-400 uppercase font-black">ø Noten/Takt</div>
                  <div className="text-[11px] font-bold text-slate-100 mt-0.5">{noteDensityStats.avg}</div>
                </div>
                <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
                  <div className="text-[8px] text-slate-400 uppercase font-black">Aufnahmelänge</div>
                  <div className="text-[11px] font-bold text-slate-100 mt-0.5">{noteDensityStats.totalBars} <span className="text-[8px] font-normal text-slate-400">Takte</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* B. Anschlagsstärke & Timing-Drift Zeitraster Heatmaps */}
        <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-velocity-heatmap">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-slate-100" />
                🥁 {heatmapMode === 'velocity' ? 'Anschlagsstärke' : 'Timing-Drift'} (16tel-Grid Heatmap)
              </h3>
              <p className="text-xs text-slate-400 mt-1 italic font-serif">
                {heatmapMode === 'velocity' 
                  ? 'Visualisierung der Anschlagsstärke (Velocity, 0-127) zur Verfeinerung deiner Dynamik.' 
                  : 'Analyse von voreiligen (Rot, Rushing) und laid-back (Blau, Dragging) Beats in Millisekunden.'}
              </p>
            </div>

            {/* Toggle Switch */}
            <div className="flex bg-slate-800 p-1 rounded border border-slate-600 font-mono text-[9px] shrink-0 self-start sm:self-center">
              <button
                onClick={() => setHeatmapMode('velocity')}
                className={`px-2.5 py-1 rounded transition-all cursor-pointer font-bold ${heatmapMode === 'velocity' ? 'bg-slate-700 text-slate-100 shadow-sm border border-slate-500' : 'text-slate-400 hover:text-slate-200'}`}
              >
                VELOCITY
              </button>
              <button
                onClick={() => setHeatmapMode('drift')}
                className={`px-2.5 py-1 rounded transition-all cursor-pointer font-bold ${heatmapMode === 'drift' ? 'bg-slate-700 text-slate-100 shadow-sm border border-slate-500' : 'text-slate-400 hover:text-slate-200'}`}
              >
                TIMING DRIFT (ms)
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col sm:flex-row gap-5">
            {/* Heatmap Grid (Left) */}
            <div className="flex-1 bg-slate-800/40 p-4 rounded border border-slate-700/50 flex flex-col justify-center">
              {/* Columns headers: Beat 1-4 */}
              <div className="grid grid-cols-5 gap-1 text-center font-mono text-[8px] font-bold text-slate-400 mb-1.5">
                <div></div>
                <div>BEAT 1</div>
                <div>BEAT 2</div>
                <div>BEAT 3</div>
                <div>BEAT 4</div>
              </div>

              {/* Grid Content Rows */}
              <div className="flex flex-col gap-1.5">
                {["1 (Downbeat)", "e (Offbeat)", "+ (Backbeat)", "a (Offbeat)"].map((rowName, rIdx) => (
                  <div key={rIdx} className="grid grid-cols-5 gap-1.5 items-center">
                    {/* Identifier */}
                    <div className="text-[7.5px] font-mono font-bold text-slate-400 truncate uppercase text-right pr-1 select-none">
                      {rowName}
                    </div>

                    {/* Beats columns */}
                    {[0, 1, 2, 3].map((cIdx) => {
                      const stepIdx = cIdx * 4 + rIdx;
                      const isHovered = hoveredCell?.step === stepIdx;
                      const beatNum = cIdx + 1;
                      const subLabels = ["1", "e", "+", "a"];
                      const subLabel = subLabels[rIdx];

                      if (heatmapMode === 'velocity') {
                        const cellData = velocityHeatmapData[stepIdx] || { step: stepIdx, avgVelocity: 0, noteCount: 0 };
                        const hasNotes = cellData.noteCount > 0;
                        const velocityIntensity = hasNotes ? cellData.avgVelocity / 127 : 0;
                        const textColorClass = velocityIntensity > 0.35 ? "text-white" : "text-slate-300";
                        
                        const inlineBg = hasNotes
                          ? `rgba(30, 41, 59, ${0.15 + velocityIntensity * 0.8})`
                          : 'rgba(203, 213, 225, 0.2)';

                        return (
                          <div
                            key={cIdx}
                            onMouseEnter={() => setHoveredCell({
                              step: stepIdx,
                              beat: beatNum,
                              sub: subLabel,
                              avgVel: cellData.avgVelocity,
                              count: cellData.noteCount,
                              avgDrift: 0
                            })}
                            onMouseLeave={() => setHoveredCell(null)}
                            className={`h-9 rounded border transition-all duration-150 cursor-crosshair flex flex-col items-center justify-center font-mono ${textColorClass} ${
                              isHovered 
                                ? 'ring-2 ring-slate-100 scale-105 border-slate-400 shadow-sm z-10' 
                                : 'border-slate-600'
                            }`}
                            style={{ backgroundColor: inlineBg }}
                          >
                            <span className="text-[10px] font-bold">{hasNotes ? cellData.avgVelocity : '-'}</span>
                            <span className="text-[7px] opacity-75 leading-none">
                              {hasNotes ? `${cellData.noteCount}n` : ''}
                            </span>
                          </div>
                        );
                      } else {
                        // Drift Heatmap Mode
                        const cellData = driftHeatmapData[stepIdx] || { step: stepIdx, avgDrift: 0, noteCount: 0 };
                        const hasNotes = cellData.noteCount > 0;
                        const driftVal = cellData.avgDrift;
                        const absDrift = Math.abs(driftVal);
                        
                        // Scale absolute drift to a 0-1 ratio clamped at 20ms
                        const driftIntensity = hasNotes ? Math.min(1, absDrift / 20) : 0;
                        const textColorClass = driftIntensity > 0.35 ? "text-white" : "text-slate-300";
                        
                        // Early = Red, Late = Blue
                        let inlineBg = 'rgba(203, 213, 225, 0.2)';
                        if (hasNotes) {
                          if (driftVal < 0) {
                            inlineBg = `rgba(239, 68, 68, ${0.15 + driftIntensity * 0.85})`;
                          } else {
                            inlineBg = `rgba(59, 130, 246, ${0.15 + driftIntensity * 0.85})`;
                          }
                        }

                        return (
                          <div
                            key={cIdx}
                            onMouseEnter={() => setHoveredCell({
                              step: stepIdx,
                              beat: beatNum,
                              sub: subLabel,
                              avgVel: 0,
                              count: cellData.noteCount,
                              avgDrift: driftVal
                            })}
                            onMouseLeave={() => setHoveredCell(null)}
                            className={`h-9 rounded border transition-all duration-150 cursor-crosshair flex flex-col items-center justify-center font-mono ${textColorClass} ${
                              isHovered 
                                ? 'ring-2 ring-slate-100 scale-105 border-slate-400 shadow-sm z-10' 
                                : 'border-slate-600'
                            }`}
                            style={{ backgroundColor: inlineBg }}
                          >
                            <span className="text-[9px] font-bold">
                              {hasNotes ? `${driftVal > 0 ? '+' : ''}${driftVal}` : '-'}
                            </span>
                            <span className="text-[6.5px] opacity-75 leading-none">
                              {hasNotes ? `${cellData.noteCount}n` : ''}
                            </span>
                          </div>
                        );
                      }
                    })}
                  </div>
                ))}
              </div>

              {/* Color guide */}
              {heatmapMode === 'velocity' ? (
                <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-600 font-mono text-[7.5px] text-slate-400">
                  <span>GHOSTNOTE (-)</span>
                  <div className="flex gap-0.5 h-1 w-16 bg-slate-600 rounded-sm overflow-hidden">
                    <div className="w-1/4 bg-slate-800/25"></div>
                    <div className="w-1/4 bg-slate-800/45"></div>
                    <div className="w-1/4 bg-slate-800/70"></div>
                    <div className="w-1/4 bg-slate-800/95"></div>
                  </div>
                  <span>ACCENT (127)</span>
                </div>
              ) : (
                <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-600 font-mono text-[7.5px] text-slate-400">
                  <span className="text-red-400 font-bold">◀ FRÜH (RUSHING)</span>
                  <div className="flex gap-0.5 h-1 w-20 bg-slate-600 rounded-sm overflow-hidden">
                    <div className="w-1/2 bg-red-400"></div>
                    <div className="w-1/2 bg-blue-400"></div>
                  </div>
                  <span className="text-blue-400 font-bold">SPÄT (DRAGGING) ▶</span>
                </div>
              )}
            </div>

            {/* Analysis card panel (Right) */}
              <div className="w-full sm:w-44 flex flex-col justify-between font-mono text-[10px]">
                <div className="bg-slate-800/40 border border-slate-600 rounded p-3 flex-1 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <span className="text-[8px] text-slate-400 font-bold block uppercase tracking-wider">Takt-Auszug</span>
                  
                  {hoveredCell ? (
                    <div className="mt-2 space-y-1.5 animate-fade-in text-[10px]">
                      <div className="font-bold text-slate-100 border-b border-slate-600 pb-0.5 flex justify-between">
                        <span>Zählzeit:</span>
                        <span className="text-slate-200">Beat {hoveredCell.beat}.{hoveredCell.sub}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          {heatmapMode === 'velocity' ? 'ø Velocity:' : 'ø Drift Dev:'}
                        </span>
                        <span className="text-slate-100 font-bold">
                          {heatmapMode === 'velocity' 
                            ? `${hoveredCell.avgVel} / 127` 
                            : `${hoveredCell.avgDrift > 0 ? '+' : ''}${hoveredCell.avgDrift} ms`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Anschläge:</span>
                        <span className="text-slate-100 font-bold">{hoveredCell.count}</span>
                      </div>
                      <p className="text-[8px] text-slate-400 italic mt-1.5 leading-relaxed">
                        {heatmapMode === 'velocity' ? (
                          hoveredCell.avgVel > 95 
                            ? 'Kräftiges Betonungs-Element.' 
                            : hoveredCell.avgVel > 65 
                            ? 'Konsistente Anschlagsdynamik.' 
                            : hoveredCell.avgVel > 0 
                            ? 'Feine Ghost-Note.' 
                            : 'Keine Noten besetzt.'
                        ) : (
                          hoveredCell.avgDrift < -5
                            ? 'Treibend / Rushing (Voreilig).'
                            : hoveredCell.avgDrift > 5
                            ? 'Laid-back / Dragging (Hinterher).'
                            : hoveredCell.count > 0
                            ? 'Absolut punktgenau on-grid.'
                            : 'Keine Noten besetzt.'
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 text-center text-slate-450 text-[9px] leading-relaxed">
                      Fahre mit der Maus über die Grid-Zellen links für Live-Werte.
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-600 pt-2 mt-2 space-y-1 text-[9px]">
                  {heatmapMode === 'velocity' ? (
                    <>
                      <div className="flex justify-between text-slate-400">
                        <span>Lautstärkedifferenz:</span>
                        <span className="text-slate-100 font-bold">{heatmapStats.dynamicDelta} Vel</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Groove-Akzente:</span>
                        <span className="text-slate-100 font-bold">{heatmapStats.accentuation}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-slate-400">
                        <span>Stabilster Beat:</span>
                        <span className="text-slate-100 font-bold">Beat {
                          (() => {
                            const activeDrifts = driftHeatmapData.filter(d => d.noteCount > 0);
                            if (activeDrifts.length === 0) return "-";
                            const best = [...activeDrifts].sort((a,b) => Math.abs(a.avgDrift) - Math.abs(b.avgDrift))[0];
                            const subLabels = ["1", "e", "+", "a"];
                            return `${Math.floor(best.step / 4) + 1}.${subLabels[best.step % 4]}`;
                          })()
                        }</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Tendenz:</span>
                        <span className="text-slate-100 font-bold">{
                          (() => {
                            const activeDrifts = driftHeatmapData.filter(d => d.noteCount > 0);
                            if (activeDrifts.length === 0) return "Ausgeglichen";
                            const sum = activeDrifts.reduce((acc, d) => acc + d.avgDrift, 0);
                            return sum < -5 ? "Rushing ⚡" : sum > 5 ? "Laid-Back 🐢" : "Ausgeglichen ✓";
                          })()
                        }</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
