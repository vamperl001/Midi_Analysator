/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { MidiNote, AlsFileStats, ChartDataEntry } from '../types';
import { chart as chartTheme, text as textTheme, bg } from '../theme';
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
import D3DriftHistogram from './D3DriftHistogram';
import D3TrendChart from './D3TrendChart';

interface SvgChartsProps {
  data: AlsFileStats[];
  selectedNoteKey: number | null;
  setSelectedNoteKey: (key: number | null) => void;
  chartData?: Record<string, ChartDataEntry>;
}

// Hilfsmittel zum Übersetzen von MIDI-Key in Notennamen
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function getNoteName(key: number): string {
  const noteIndex = key % 12;
  const octave = Math.floor(key / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export const SvgCharts: React.FC<SvgChartsProps> = ({ data, selectedNoteKey, setSelectedNoteKey, chartData }) => {
  // Aggregiere Chart-Daten aus allen sichtbaren Sessions
  const aggregatedChart = useMemo(() => {
    if (!chartData) return null;
    const ids = new Set(data.map(s => s.cloudDocId));
    const charts = (Object.entries(chartData) as [string, ChartDataEntry][])
      .filter(([id]) => ids.has(id))
      .map(([, c]) => c);
    if (charts.length === 0) return null;

    const totalNotes = charts.reduce((s, c) => s + c.stats.totalNotes, 0);
    if (totalNotes === 0) return null;

    function sumHist(key: 'gridOffsetHistogram' | 'gridOffsetBassHistogram' | 'gridOffsetTrebleHistogram') {
      return charts[0][key].map((bin, i) => ({
        ...bin,
        count: charts.reduce((sum, c) => sum + (c[key][i]?.count || 0), 0),
      }));
    }

    const gridOffsetHistogram = sumHist('gridOffsetHistogram');
    const gridOffsetBassHistogram = sumHist('gridOffsetBassHistogram');
    const gridOffsetTrebleHistogram = sumHist('gridOffsetTrebleHistogram');

    const velocityHistogram = charts[0].velocityHistogram.map((bin, i) => ({
      ...bin,
      count: charts.reduce((sum, c) => sum + (c.velocityHistogram[i]?.count || 0), 0),
    }));

    const keyDistribution: Record<number, number> = {};
    charts.forEach(c => {
      Object.entries(c.keyDistribution).forEach(([k, v]) => {
        keyDistribution[Number(k)] = (keyDistribution[Number(k)] || 0) + v;
      });
    });

    // Note density: align by bar index and sum
    const densityMap = new Map<number, number>();
    charts.forEach(c => {
      (c.noteDensity || []).forEach(d => {
        densityMap.set(d.bar, (densityMap.get(d.bar) || 0) + d.count);
      });
    });
    const maxBar = Math.max(...densityMap.keys(), 0);
    const noteDensity = Array.from({ length: maxBar + 1 }, (_, i) => ({
      bar: i,
      count: densityMap.get(i) || 0,
    }));

    // 16th grid: weighted average of velocity/drift
    const sixteenthGrid = charts[0].sixteenthGrid.map((cell, i) => {
      let totalCount = 0;
      let velSum = 0;
      let driftSum = 0;
      charts.forEach(c => {
        const cc = c.sixteenthGrid[i];
        totalCount += cc.count;
        velSum += cc.avgVelocity * cc.count;
        driftSum += cc.avgDrift * cc.count;
      });
      return {
        ...cell,
        count: totalCount,
        avgVelocity: totalCount > 0 ? round1(velSum / totalCount) : 0,
        avgDrift: totalCount > 0 ? round2(driftSum / totalCount) : 0,
      };
    });

    // Stats: weighted average
    const mean = charts.reduce((s, c) => s + c.stats.mean * c.stats.totalNotes, 0) / totalNotes;
    const median = charts.reduce((s, c) => s + c.stats.median * c.stats.totalNotes, 0) / totalNotes;
    const std = charts.reduce((s, c) => s + c.stats.std * c.stats.totalNotes, 0) / totalNotes;
    const earlyPct = Math.round(charts.reduce((s, c) => s + c.stats.earlyPercent * c.stats.totalNotes, 0) / totalNotes);
    const latePct = Math.round(charts.reduce((s, c) => s + c.stats.latePercent * c.stats.totalNotes, 0) / totalNotes);
    const tightPct = Math.round(charts.reduce((s, c) => s + c.stats.tightPercent * c.stats.totalNotes, 0) / totalNotes);
    const skewness = charts.reduce((s, c) => s + c.stats.skewness * c.stats.totalNotes, 0) / totalNotes;
    const bassPct = Math.round(charts.reduce((s, c) => s + (c.stats.bassPct || 0) * c.stats.totalNotes, 0) / totalNotes);

    return {
      gridOffsetHistogram,
      gridOffsetBassHistogram,
      gridOffsetTrebleHistogram,
      velocityHistogram,
      keyDistribution,
      noteDensity,
      sixteenthGrid,
      stats: {
        avg: round2(mean),
        std: round2(std),
        median: round2(median),
        earlyPercent: earlyPct,
        latePercent: latePct,
        tightPercent: tightPct,
        skewness: round2(skewness),
        bassPct,
      },
    };
  }, [chartData, data]);

  const useChartData = false;

  function round1(v: number) { return Math.round(v * 10) / 10; }
  function round2(v: number) { return Math.round(v * 100) / 100; }
  // Live Hover-Zustand für das 16tel Grid (Anschlagsstärke / Drift)
  const [heatmapMode, setHeatmapMode] = useState<'velocity' | 'drift'>('velocity');
  const [hoveredCell, setHoveredCell] = useState<{ step: number; beat: number; sub: string; avgVel: number; count: number; avgDrift: number } | null>(null);

  // --- 1. DATEN EXTRAHIEREN ---
  const allNotes = useMemo(() => {
    if (useChartData) return [];  // rohe Notes nicht laden wenn Chart-Daten vorhanden
    return data.flatMap(session => 
      session.notes.map(note => ({
        ...note,
        sessionDate: session.date,
        sessionTempo: session.tempo,
        sessionName: session.fileName
      }))
    );
  }, [data, useChartData]);

  // --- 6. PIANO KEYS HEATMAP ---
  const pianoNotesStatus = useMemo(() => {
    if (useChartData && aggregatedChart) {
      const keyDist = aggregatedChart.keyDistribution;
      const allKeys = Array.from({ length: 49 }, (_, i) => i + 36); // 36-84
      const counts: Record<number, number> = {};
      allKeys.forEach(k => { counts[k] = keyDist[k] || 0; });
      const maxCount = Math.max(...Object.values(counts), 1);
      return allKeys.map(key => ({
        key,
        name: getNoteName(key),
        count: counts[key],
        intensity: counts[key] / maxCount,
        isBlack: [1, 3, 6, 8, 10].includes(key % 12),
      }));
    }
    const counts: { [key: number]: number } = {};

    for (let k = 36; k <= 84; k++) counts[k] = 0;

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
  }, [allNotes, useChartData, aggregatedChart]);

  // Detailanzeige für die ausgewählte Note im Piano Roll
  const selectedNoteInfo = useMemo(() => {
    if (useChartData) return null;
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
  }, [allNotes, selectedNoteKey, useChartData]);

  // --- 7. NOTENDICHTE BERECHNEN (Noten pro Takt über die Zeitachse) ---
  const noteDensityData = useMemo(() => {
    if (useChartData && aggregatedChart) {
      return aggregatedChart.noteDensity.map(d => ({
        barNum: d.bar + 1,
        notesCount: d.count,
        totalVelocity: 0,
        avgVelocity: 0,
      }));
    }
    if (allNotes.length === 0) return [];
    
    // Finde das maximale Timing der aktuellen Session(s) vor
    const times = allNotes.map(n => n.time);
    const maxBeat = times.length > 0 ? times.reduce((a, b) => Math.max(a, b), 1) : 1;
    const numBars = Math.ceil(maxBeat / 4);
    
    // Initialisiere die Takte von 1 bis numBars (Sicherung bei maximal 2000 Takten)
    const barsCount = Math.min(numBars, 2000);
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
  }, [allNotes, useChartData, aggregatedChart]);

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
    if (useChartData && aggregatedChart) {
      return aggregatedChart.sixteenthGrid.map(cell => ({
        step: cell.position,
        colIndex: Math.floor(cell.position / 4),
        rowIndex: cell.position % 4,
        sumVelocity: cell.avgVelocity * cell.count,
        noteCount: cell.count,
        avgVelocity: cell.avgVelocity,
      }));
    }
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
  }, [allNotes, useChartData, aggregatedChart]);

  // --- 8B. DURCHSCHNITTLICHES TIMING DRIFT IM 16TEL-RASTER BERECHNEN (HEATMAP) ---
  const driftHeatmapData = useMemo(() => {
    if (useChartData && aggregatedChart) {
      return aggregatedChart.sixteenthGrid.map(cell => ({
        step: cell.position,
        colIndex: Math.floor(cell.position / 4),
        rowIndex: cell.position % 4,
        sumDrift: cell.avgDrift * cell.count,
        noteCount: cell.count,
        avgDrift: cell.avgDrift,
      }));
    }
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
  }, [allNotes, useChartData, aggregatedChart]);

  // Heatmap-Statistik (Ampli-Hüllkurven Profiling)
  const heatmapStats = useMemo(() => {
    const activeSteps = velocityHeatmapData.filter(s => s.noteCount > 0);
    if (activeSteps.length === 0) return { min: 0, max: 0, dynamicDelta: 0, accentuation: "Homogen" };
    
    const vels = activeSteps.map(s => s.avgVelocity);
    const min = vels.reduce((a, b) => Math.min(a, b), vels[0]);
    const max = vels.reduce((a, b) => Math.max(a, b), vels[0]);
    const dynamicDelta = Math.round((max - min) * 10) / 10;
    
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
      
      <D3DriftHistogram
        sessions={data}
        selectedNoteKey={selectedNoteKey}
        onSelectNoteKey={setSelectedNoteKey}
      />

      <D3TrendChart sessions={data} />

      {/* 3. INTERAKTIV PIANO ROLL – Tastatur & Detail */}
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-piano-roll">
        <div className="mb-4">
          <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono">
            🎹 Tonleiter-Verteilung & Timing-Zoom
          </h3>
          <p className="text-xs text-slate-400 mt-1 italic font-serif">
            Klicke auf eine Taste, um Timing & Dynamik isoliert anzuzeigen.
          </p>
        </div>

        {/* Piano-Roll Dichte – horizontale Klaviatur */}
        <div className="bg-slate-950 rounded border border-slate-700/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Klaviatur</span>
            <span className="text-[8px] text-slate-500 font-mono">dunkler = häufiger gespielt</span>
          </div>
          <div className="flex gap-0.5 overflow-x-auto pb-1" style={{ flexWrap: 'wrap' }}>
            {pianoNotesStatus.map((item) => {
              const isSelected = selectedNoteKey === item.key;
              return (
                <div
                  key={item.key}
                  className={`w-6 h-6 flex items-center justify-center text-[7px] font-mono font-bold rounded-sm cursor-pointer hover:ring-1 hover:ring-slate-400 shrink-0 transition-all ${isSelected ? 'ring-2 ring-indigo-400 scale-110' : ''}`}
                  style={{
                    backgroundColor: isSelected
                      ? '#6366f1'
                      : `rgba(99, 102, 241, ${0.08 + item.intensity * 0.82})`,
                    color: isSelected ? 'white' : item.intensity > 0.5 ? 'white' : '#475569',
                  }}
                  title={`${item.name}: ${item.count} mal`}
                  onClick={() => setSelectedNoteKey(isSelected ? null : item.key)}
                >
                  {item.name}
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail-Panel */}
        <div className="mt-3 p-3 rounded bg-slate-950 border border-slate-700/50 font-mono text-[10px]" id="piano-key-detail">
          {selectedNoteInfo ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <div className="text-slate-100 font-bold flex items-center gap-2">
                <span className="bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 rounded">MIDI {selectedNoteKey}</span>
                <span>Note {selectedNoteInfo.noteName}</span>
              </div>
              <span className="text-slate-400">Events: <span className="text-slate-100 font-medium">{selectedNoteInfo.count}</span></span>
              <span className="text-slate-400">Trend: <span className={`font-medium ${parseFloat(selectedNoteInfo.avgDriftMs) > 0 ? 'text-blue-400' : 'text-slate-100'}`}>
                {parseFloat(selectedNoteInfo.avgDriftMs) > 0 ? 'Laid-back' : 'Ahead'} ({selectedNoteInfo.avgDriftMs}ms)
              </span></span>
              <span className="text-slate-400">Fehler ø: <span className="text-slate-100 font-medium">{selectedNoteInfo.absDriftMs} ms</span></span>
              <span className="text-slate-400">Anschlag: <span className="text-blue-400 font-medium">{selectedNoteInfo.avgVelocity}</span></span>
              <button 
                onClick={() => setSelectedNoteKey(null)}
                className="text-[9px] bg-slate-700 hover:bg-slate-600 text-slate-200 py-0.5 px-2 rounded border border-slate-600 transition-colors cursor-pointer"
              >
                Zurücksetzen
              </button>
            </div>
          ) : (
            <div className="text-slate-400 text-center text-[10px] py-1">
              Wähle eine Taste aus der Klaviatur oben.
            </div>
          )}
        </div>

        <div className="mt-3 p-2.5 bg-slate-800/60 border border-slate-600 rounded text-slate-300 text-[10px] font-mono flex items-start gap-2">
          <span>💡</span>
          <span>Tiefe Noten (C2–C3) zeigen oft einen stabileren Groove als hohe Lagen.</span>
        </div>
      </div>

    </div>
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
