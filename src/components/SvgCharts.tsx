/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { MidiNote, AlsFileStats, ChartDataEntry } from '../types';
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
import { computeKde } from '../backendApi';

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

  const useChartData = !!aggregatedChart;

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

  // Für die Histogramm-Berechnung filtern wir ggf. nach der ausgewählten Note (Piano Roll)
  const filteredNotesForHistogram = useMemo(() => {
    if (useChartData) return [];
    if (selectedNoteKey === null) return allNotes;
    return allNotes.filter(n => n.key === selectedNoteKey);
  }, [allNotes, selectedNoteKey, useChartData]);

  // --- 2. STATISTIKEN BERECHNEN ---
  const stats = useMemo(() => {
    if (useChartData && aggregatedChart) {
      return aggregatedChart.stats;
    }
    const notesCount = filteredNotesForHistogram.length;
    if (notesCount === 0) return { avg: 0, std: 0, earlyPercent: 50, latePercent: 50, tightPercent: 0, median: 0, skewness: 0, bassPct: 0 };

    const offsets = filteredNotesForHistogram.map(n => n.gridOffsetMs);
    const sum = offsets.reduce((s, val) => s + val, 0);
    const avg = sum / notesCount;
    
    // Standardabweichung
    const variance = offsets.reduce((s, val) => s + Math.pow(val - avg, 2), 0) / notesCount;
    const std = Math.sqrt(variance);

    // Schiefe (Skewness)
    const m3 = offsets.reduce((s, val) => s + Math.pow(val - avg, 3), 0) / notesCount;
    const skewness = std > 0 ? m3 / Math.pow(std, 3) : 0;

    // Median
    const sorted = [...offsets].sort((a, b) => a - b);
    const median = sorted[Math.floor(notesCount / 2)];

    // Early vs Late
    const early = offsets.filter(o => o < -1.5).length;
    const late = offsets.filter(o => o > 1.5).length;
    const tight = notesCount - early - late;

    const earlyPercent = Math.round((early / notesCount) * 100);
    const latePercent = Math.round((late / notesCount) * 100);
    const tightPercent = 100 - earlyPercent - latePercent;

    const bassPct = Math.round((filteredNotesForHistogram.filter(n => n.key < 60).length / notesCount) * 100);

    return { avg, std, earlyPercent, latePercent, tightPercent, median, skewness, bassPct };
  }, [filteredNotesForHistogram, useChartData, aggregatedChart]);

  // --- 3. HISTOGRAMM BINS MIT REGISTER-SPLIT ---
  const MIDDLE_C = 60;
  const registerSplit = useMemo(() => {
    if (useChartData) return { bassNotes: [], trebleNotes: [] };
    const bassNotes = filteredNotesForHistogram.filter(n => n.key < MIDDLE_C);
    const trebleNotes = filteredNotesForHistogram.filter(n => n.key >= MIDDLE_C);
    return { bassNotes, trebleNotes };
  }, [filteredNotesForHistogram, useChartData]);

  const minMs = -50;
  const maxMs = 50;
  const binSize = 2;

  function buildHistogram(offsets: number[]): { lower: number; upper: number; mid: number; count: number }[] {
    const numBins = Math.ceil((maxMs - minMs) / binSize);
    const bins = Array.from({ length: numBins }, (_, idx) => {
      const lower = minMs + idx * binSize;
      return { lower, upper: lower + binSize, mid: lower + binSize / 2, count: 0 };
    });
    for (const offset of offsets) {
      for (const bin of bins) {
        if (offset >= bin.lower && offset < bin.upper) {
          bin.count++;
          break;
        }
      }
    }
    return bins;
  }

  const histBass = useMemo(() => {
    if (useChartData && aggregatedChart) return aggregatedChart.gridOffsetBassHistogram;
    return buildHistogram(registerSplit.bassNotes.map(n => n.gridOffsetMs));
  }, [registerSplit.bassNotes, useChartData, aggregatedChart]);
  const histTreble = useMemo(() => {
    if (useChartData && aggregatedChart) return aggregatedChart.gridOffsetTrebleHistogram;
    return buildHistogram(registerSplit.trebleNotes.map(n => n.gridOffsetMs));
  }, [registerSplit.trebleNotes, useChartData, aggregatedChart]);
  const histAll = useMemo(() => {
    if (useChartData && aggregatedChart) return aggregatedChart.gridOffsetHistogram;
    return buildHistogram(filteredNotesForHistogram.map(n => n.gridOffsetMs));
  }, [filteredNotesForHistogram, useChartData, aggregatedChart]);

  const maxBinCount = useMemo(() => {
    const all = [...histBass, ...histTreble, ...histAll].map(b => b.count);
    return all.length > 0 ? Math.max(...all, 1) : 1;
  }, [histBass, histTreble, histAll]);

  // --- KDE (Kernel Density Estimate) for smooth violin-curve ---
  const [kdePoints, setKdePoints] = useState<{ all: { x: number; y: number }[]; bass: { x: number; y: number }[]; treble: { x: number; y: number }[] }>({ all: [], bass: [], treble: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const allOffsets = filteredNotesForHistogram.map(n => n.gridOffsetMs);
      const bassOffsets = registerSplit.bassNotes.map(n => n.gridOffsetMs);
      const trebleOffsets = registerSplit.trebleNotes.map(n => n.gridOffsetMs);
      try {
        const [all, bass, treble] = await Promise.all([
          computeKde(allOffsets, 200),
          bassOffsets.length > 50 ? computeKde(bassOffsets, 200) : Promise.resolve([]),
          trebleOffsets.length > 50 ? computeKde(trebleOffsets, 200) : Promise.resolve([]),
        ]);
        if (!cancelled) setKdePoints({ all, bass, treble });
      } catch {
        if (!cancelled) setKdePoints({ all: [], bass: [], treble: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [filteredNotesForHistogram, registerSplit]);

  const maxKdeY = useMemo(() => {
    const all = [...kdePoints.all, ...kdePoints.bass, ...kdePoints.treble].map(p => p.y);
    return all.length > 0 ? Math.max(...all, 0.001) : 1;
  }, [kdePoints]);

  // Build SVG path for KDE curve
  function kdePath(kde: { x: number; y: number }[], svgWidth: number, svgHeight: number, xMin: number, xMax: number): string {
    if (kde.length < 2) return '';
    const xRange = xMax - xMin || 1;
    const parts = kde.map((p, i) => {
      const sx = ((p.x - xMin) / xRange) * svgWidth;
      const sy = svgHeight - (p.y / maxKdeY) * svgHeight * 0.85;
      return i === 0 ? `M${sx},${sy}` : `L${sx},${sy}`;
    });
    return parts.join(' ');
  }

  function kdeFillPath(kde: { x: number; y: number }[], svgWidth: number, svgHeight: number, xMin: number, xMax: number): string {
    if (kde.length < 2) return '';
    const xRange = xMax - xMin || 1;
    const p0 = ((kde[0].x - xMin) / xRange) * svgWidth;
    const pN = ((kde[kde.length - 1].x - xMin) / xRange) * svgWidth;
    return kdePath(kde, svgWidth, svgHeight, xMin, xMax) + ` L${pN},${svgHeight} L${p0},${svgHeight} Z`;
  }

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
          <svg className="w-full h-44" viewBox="0 0 300 120" preserveAspectRatio="none">
              {/* Grid Linien */}
              <line x1="150" y1="0" x2="150" y2="110" stroke={chartTheme.zeroLine} strokeDasharray="3,2" strokeWidth="1" />
              <line x1="50" y1="0" x2="50" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />
              <line x1="100" y1="0" x2="100" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />
              <line x1="200" y1="0" x2="200" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />
              <line x1="250" y1="0" x2="250" y2="110" stroke={chartTheme.axis} strokeWidth="0.5" />

            {/* Treble-Balken (oben/hinter) */}
            {histTreble.map((bin, idx) => {
              const x = (idx / histTreble.length) * 300;
              const barHeight = (bin.count / maxBinCount) * 100;
              return (
                <rect key={`t-${idx}`}
                  x={x} y={110 - barHeight}
                  width={Math.max(0.5, 300 / histTreble.length - 0.5)}
                  height={barHeight}
                  fill="#818cf8"
                  opacity="0.5"
                >
                  <title>{`Diskant ${bin.lower} bis ${bin.upper} ms: ${bin.count} Noten`}</title>
                </rect>
              );
            })}

            {/* Bass-Balken (vorn) */}
            {histBass.map((bin, idx) => {
              const x = (idx / histBass.length) * 300;
              const barHeight = (bin.count / maxBinCount) * 100;
              return (
                <rect key={`b-${idx}`}
                  x={x} y={110 - barHeight}
                  width={Math.max(0.5, 300 / histBass.length - 0.5)}
                  height={barHeight}
                  fill="#f59e0b"
                  opacity="0.6"
                >
                  <title>{`Bass ${bin.lower} bis ${bin.upper} ms: ${bin.count} Noten`}</title>
                </rect>
              );
            })}

            {/* KDE-Kurven (Violin-Plot) */}
            {kdePoints.all.length > 0 && (() => {
              const fillD = kdeFillPath(kdePoints.all, 300, 110, minMs, maxMs);
              const lineD = kdePath(kdePoints.all, 300, 110, minMs, maxMs);
              return (
                <>
                  <path d={fillD} fill="#6366f1" opacity="0.12" />
                  <path d={lineD} fill="none" stroke="#a5b4fc" strokeWidth="1.5" opacity="0.8" />
                </>
              );
            })()}
            {kdePoints.bass.length > 0 && (() => {
              const d = kdePath(kdePoints.bass, 300, 110, minMs, maxMs);
              return <path d={d} fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />;
            })()}
            {kdePoints.treble.length > 0 && (() => {
              const d = kdePath(kdePoints.treble, 300, 110, minMs, maxMs);
              return <path d={d} fill="none" stroke="#818cf8" strokeWidth="1.5" opacity="0.6" />;
            })()}

            {/* Nullstellenlinie Text */}
            <text x="153" y="12" fill={accent.red} fontSize="7" fontFamily="monospace" fontWeight="bold">Grid-Soll (0ms)</text>
          </svg>
          
          {/* Legende */}
          <div className="flex gap-4 mt-1 text-[9px] font-mono text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 opacity-60" /> Bass (&lt;C4)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-400 opacity-50" /> Diskant (&ge;C4)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-300 opacity-80" /> KDE (Gesamt)</span>
          </div>

          {/* X Achsenbeschriftung */}
          <div className="flex justify-between mt-2 px-1 text-[9px] font-mono text-slate-400">
            <span>-50ms (Früh)</span>
            <span>0ms</span>
            <span>+50ms (Spät)</span>
          </div>
        </div>

        {/* Statistiken */}
        <div className="grid grid-cols-4 gap-2 mt-4 text-center font-mono">
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
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">Schiefe (Skew)</div>
            <div className={`text-xs font-bold ${Math.abs(stats.skewness) > 0.3 ? 'text-amber-400' : 'text-slate-100'}`}>
              {stats.skewness > 0 ? `+${stats.skewness.toFixed(2)}` : stats.skewness.toFixed(2)}
            </div>
          </div>
          <div className="bg-slate-800/40 p-2.5 rounded border border-slate-700/50">
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">Early/Late</div>
            <div className="text-[10px] font-bold text-slate-300 mt-0.5">
              -{stats.earlyPercent}% | +{stats.latePercent}%<span className="text-[8px] text-slate-500 ml-1">Bass {stats.bassPct}%</span>
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
            <svg className="w-full h-44" viewBox="0 0 300 120" preserveAspectRatio="none">
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

        {/* Note Density Strip - horizontal heatmap */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Piano-Roll Dichte</span>
            <span className="text-[8px] text-slate-500 font-mono">dunkler = häufiger</span>
          </div>
          <div className="flex gap-0.5 overflow-x-auto pb-1" style={{ flexWrap: 'wrap' }}>
            {pianoNotesStatus.map((item) => (
              <div
                key={item.key}
                className="w-6 h-5 flex items-center justify-center text-[7px] font-mono font-bold rounded-sm cursor-pointer hover:ring-1 hover:ring-slate-400 shrink-0"
                style={{
                  backgroundColor: `rgba(99, 102, 241, ${0.08 + item.intensity * 0.82})`,
                  color: item.intensity > 0.5 ? 'white' : '#475569',
                }}
                title={`${item.name}: ${item.count} mal`}
                onClick={() => setSelectedNoteKey(selectedNoteKey === item.key ? null : item.key)}
              >
                {item.name}
              </div>
            ))}
          </div>
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
