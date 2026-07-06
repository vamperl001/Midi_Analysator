/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Activity, 
  Zap, 
  Clock, 
  Music, 
  Percent, 
  Sparkles, 
  Info,
  CheckCircle2,
  TrendingUp,
  Flame,
  AlertTriangle
} from 'lucide-react';
import { AlsFileStats } from '../types';

interface CalendarViewProps {
  data: AlsFileStats[];
  setSelectedFileIdx: (idx: number | null) => void;
  setActiveTab: (tab: "dashboard" | "database" | "python" | "calendar") => void;
  setSelectedMonth: (month: string) => void;
}

const GERMAN_WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const GERMAN_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni"];

export const CalendarView: React.FC<CalendarViewProps> = ({ 
  data, 
  setSelectedFileIdx, 
  setActiveTab,
  setSelectedMonth
}) => {
  // Lokaler State für den im Kalender angezeigten Monat (0 = Januar, 5 = Juni)
  const [calendarMonth, setCalendarMonth] = useState<number>(4); // Default: Mai 2026 (Monat 4)
  const [selectedDaySession, setSelectedDaySession] = useState<AlsFileStats | null>(null);
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'timeline'>('calendar');

  const sortedSessions = useMemo(() => {
    return [...data].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  // --- 1. WOCHENTAGS-STATISTIKEN (Mo-So) ---
  const weekdayStats = useMemo(() => {
    // weekday-Index: 0 = Sonntag, 1 = Montag ... 6 = Samstag
    const grouped: { [key: number]: { count: number; totalDrift: number; totalSwing: number; totalVelocity: number; totalTempo: number; sessions: AlsFileStats[] } } = {};
    for (let i = 0; i < 7; i++) {
      grouped[i] = { count: 0, totalDrift: 0, totalSwing: 0, totalVelocity: 0, totalTempo: 0, sessions: [] };
    }

    data.forEach(s => {
      const dayIndex = new Date(s.date).getDay();
      grouped[dayIndex].count++;
      grouped[dayIndex].totalDrift += s.avgDriftMs;
      grouped[dayIndex].totalSwing += s.swingFactor16th;
      grouped[dayIndex].totalVelocity += s.avgVelocity;
      grouped[dayIndex].totalTempo += s.tempo;
      grouped[dayIndex].sessions.push(s);
    });

    // Neu mappen in Reihenfolge Montag (1) bis Sonntag (0)
    const mapIndex = [1, 2, 3, 4, 5, 6, 0];
    return mapIndex.map((idx, originalArrIndex) => {
      const raw = grouped[idx];
      const count = raw.count;
      return {
        originalArrIndex, // Helper ID for layout mappings (0 to 6)
        weekdayIdx: idx,
        name: GERMAN_WEEKDAYS[idx === 0 ? 6 : idx - 1],
        shortName: GERMAN_WEEKDAYS[idx === 0 ? 6 : idx - 1].slice(0, 2),
        count,
        avgDrift: count > 0 ? parseFloat((raw.totalDrift / count).toFixed(1)) : 0,
        avgSwing: count > 0 ? parseFloat((raw.totalSwing / count).toFixed(1)) : 50,
        avgVelocity: count > 0 ? Math.round(raw.totalVelocity / count) : 100,
        avgTempo: count > 0 ? parseFloat((raw.totalTempo / count).toFixed(1)) : 120,
        sessions: raw.sessions
      };
    });
  }, [data]);

  // --- 2. JAHRES-HIGHLIGHTS AUS DER TIMING PERSPEKTIVE ---
  const highlights = useMemo(() => {
    const validDays = weekdayStats.filter(w => w.count > 0);
    if (validDays.length === 0) return null;

    const tightestDay = [...validDays].sort((a, b) => a.avgDrift - b.avgDrift)[0];
    const swingiestDay = [...validDays].sort((a, b) => b.avgSwing - a.avgSwing)[0];
    const mostProductiveDay = [...validDays].sort((a, b) => b.count - a.count)[0];

    return {
      tightest: tightestDay,
      swingiest: swingiestDay,
      productive: mostProductiveDay
    };
  }, [weekdayStats]);

  // --- 3. DYNAMISCHE DIAGNOSE DER ÜBUNGSDISZIPLIN ---
  const dynamicDisciplineInsights = useMemo(() => {
    const validDays = weekdayStats.filter(w => w.count > 0);
    if (validDays.length === 0) return null;

    // Split in Arbeitstage (Mon-Fre) und Wochenende (Sam-Son)
    const weekdays = weekdayStats.filter(w => w.weekdayIdx >= 1 && w.weekdayIdx <= 5 && w.count > 0);
    const weekends = weekdayStats.filter(w => (w.weekdayIdx === 0 || w.weekdayIdx === 6) && w.count > 0);

    const getAvg = (arr: typeof weekdayStats) => {
      if (arr.length === 0) return { drift: 0, tempo: 0, count: 0 };
      const totDrift = arr.reduce((acc, curr) => acc + curr.avgDrift * curr.count, 0);
      const totTempo = arr.reduce((acc, curr) => acc + curr.avgTempo * curr.count, 0);
      const totCount = arr.reduce((acc, curr) => acc + curr.count, 0);
      return {
        drift: totCount > 0 ? totDrift / totCount : 0,
        tempo: totCount > 0 ? totTempo / totCount : 120,
        count: totCount
      };
    };

    const weekdayAvg = getAvg(weekdays);
    const weekendAvg = getAvg(weekends);

    // Tempo Spitzenreiter
    const fastestDay = [...validDays].sort((a, b) => b.avgTempo - a.avgTempo)[0];
    const tightestDay = [...validDays].sort((a, b) => a.avgDrift - b.avgDrift)[0];
    const loosestDay = [...validDays].sort((a, b) => b.avgDrift - a.avgDrift)[0];

    // Übungsfokus (Wo wird am meisten trainiert?)
    const maxSessionsDay = [...validDays].sort((a, b) => b.count - a.count)[0];

    // Erzeugen von datengetriebenen Erkenntnissen
    let title = "Stabiles Studio-Timing";
    let text = "Deine Timing-Präzision bleibt bemerkenswert konstant über die gesamte Woche.";
    let category = "Balanced";
    let score = "A";

    if (weekdayAvg.count > 0 && weekendAvg.count > 0) {
      if (weekendAvg.drift > weekdayAvg.drift + 2.5) {
        title = "Kreativer Wochenend-Groove VS. Wochentags-Genauigkeit";
        text = `Unter der Woche spielst du extrem fokussiert und akkurat mit im Schnitt nur ${weekdayAvg.drift.toFixed(1)}ms Drift. Am Wochenende lässt du den Groove etwas lockerer fließen (${weekendAvg.drift.toFixed(1)}ms Drift) — optimal für organische Swing-Tracks!`;
        category = "Creative Shift";
        score = "A-";
      } else if (weekdayAvg.drift > weekendAvg.drift + 2.5) {
        title = "Sensationeller Wochenend-Fokus!";
        text = `Interessanterweise steigerst du deine Präzision am Wochenende erheblich (ø ${weekendAvg.drift.toFixed(1)}ms Drift gegenüber ${weekdayAvg.drift.toFixed(1)}ms an stressigen Werktagen). Du scheinst mehr Zeit für ungestörtes Recording zu haben.`;
        category = "Weekend Precision";
        score = "A+";
      } else if (weekendAvg.tempo > weekdayAvg.tempo + 5) {
        title = "High-Tempo Wochenendsitzung";
        text = `Am Wochenende bevorzugst du energetischere, schnellere Projekte (ø ${weekendAvg.tempo.toFixed(0)} BPM) im Vergleich zu den entspannteren ${weekdayAvg.tempo.toFixed(0)} BPM unter der Woche. Beeindruckend: Deine Drift verschlechtert sich dabei kaum!`;
        category = "Energized Weekend";
        score = "A";
      } else {
        title = "Herausragende motorische Timing-Konstanz";
        text = `Ob Werktag oder Wochenende: Deine zeitliche Genauigkeit weicht kaum voneinander ab (Abweichungsdifferenz unter ${Math.abs(weekdayAvg.drift - weekendAvg.drift).toFixed(1)}ms). Das spricht für eine automatisierte und hochfokussierte Spieltechnik am Midi-Controller.`;
        category = "Master Timing";
        score = "S-Tier";
      }
    }

    return {
      weekdayAvg,
      weekendAvg,
      fastestDay,
      tightestDay,
      loosestDay,
      maxSessionsDay,
      title,
      text,
      category,
      score
    };
  }, [weekdayStats]);

  // --- 4. ERSTELLUNG DER KALENDER-MATRIX FÜR DEN GEWÄHLTEN MONAT ---
  const calendarCells = useMemo(() => {
    const year = 2026;
    // index 1-based days count
    const numDays = new Date(year, calendarMonth + 1, 0).getDate();
    // Weekday of the 1st of the month: 0 (Sunday) to 6 (Saturday)
    const firstDayOfWeekRaw = new Date(year, calendarMonth, 1).getDay();
    // Adjust to Monday-first: Monday (0) to Sunday (6)
    const paddingLeft = firstDayOfWeekRaw === 0 ? 6 : firstDayOfWeekRaw - 1;

    const cells: Array<{ dayNum: number | null; dateString: string; session: AlsFileStats | null }> = [];

    // Auffüllen der leeren Tage links
    for (let p = 0; p < paddingLeft; p++) {
      cells.push({ dayNum: null, dateString: '', session: null });
    }

    // Tage des Monats
    for (let day = 1; day <= numDays; day++) {
      const paddedDay = day.toString().padStart(2, '0');
      const paddedMonth = (calendarMonth + 1).toString().padStart(2, '0');
      const dateString = `${year}-${paddedMonth}-${paddedDay}`;
      
      const session = data.find(s => s.date === dateString) || null;
      cells.push({ dayNum: day, dateString, session });
    }

    return cells;
  }, [calendarMonth, data]);

  // Handler für Vor/Zurück Paging des Kalendermonats
  const handlePrevMonth = () => {
    setCalendarMonth(prev => (prev > 0 ? prev - 1 : 5));
    setSelectedDaySession(null);
  };

  const handleNextMonth = () => {
    setCalendarMonth(prev => (prev < 5 ? prev + 1 : 0));
    setSelectedDaySession(null);
  };

  // Fokusiert die gewählte Session im Haupt-Dashboard und springt dorthin
  const handleFocusSessionInDashboard = (session: AlsFileStats) => {
    const fullIndex = data.findIndex(s => s.fileName === session.fileName);
    if (fullIndex !== -1) {
      setSelectedFileIdx(fullIndex);
      const fileMonth = new Date(session.date).getMonth().toString();
      setSelectedMonth(fileMonth);
      setActiveTab("dashboard");
    }
  };

  // --- 5. SVG CHART KOORDINATER & CONFIGURATON ---
  const svgWidth = 600;
  const svgHeight = 240;
  const paddingLeft = 55;
  const paddingRight = 55;
  const paddingTop = 35;
  const paddingBottom = 40;
  
  const chartW = svgWidth - paddingLeft - paddingRight;
  const chartH = svgHeight - paddingTop - paddingBottom;
  
  // X-Koordinaten für 7 Wochentage (Index 0 bis 6)
  const xCoords = useMemo(() => {
    return [0, 1, 2, 3, 4, 5, 6].map(i => paddingLeft + i * (chartW / 6));
  }, [chartW, paddingLeft]);

  // Y-Skalierung für Tempo (BPM Bereich: 60 bis 160)
  const getTempoY = (tempo: number) => {
    const percent = Math.min(1, Math.max(0, (tempo - 60) / 100)); // 60 bis 160 BPM
    return paddingTop + chartH * (1 - percent);
  };

  // Y-Skalierung für Drift (ms Bereich: 0 bis 25)
  const getDriftY = (drift: number) => {
    const percent = Math.min(1, Math.max(0, drift / 25)); // 0 bis 25 ms
    return paddingTop + chartH * (1 - percent);
  };

  // Filtern für die Verbindungslinie im SVG (nur Tage an denen Sessions existieren)
  const activeDriftPoints = useMemo(() => {
    return weekdayStats.map((item, idx) => ({
      x: xCoords[idx],
      y: getDriftY(item.avgDrift),
      active: item.count > 0,
      drift: item.avgDrift,
      originalIndex: idx
    })).filter(pt => pt.active);
  }, [weekdayStats, xCoords]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in" id="calendar-section">
      
      {/* TAB SWITCHER BAR */}
      <div className="lg:col-span-3 flex border-b border-slate-700 bg-slate-900 rounded-lg p-1.5 shadow-sm font-mono text-xs gap-1.5 justify-start items-center">
        <button 
          onClick={() => setViewMode("calendar")}
          className={`py-2 px-4 rounded-md font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
            viewMode === "calendar" 
              ? "bg-slate-900 text-white shadow-sm" 
              : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/60"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          📅 Wochen-Kalender & Vergleiche
        </button>
        <button 
          onClick={() => setViewMode("timeline")}
          className={`py-2 px-4 rounded-md font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
            viewMode === "timeline" 
              ? "bg-slate-900 text-white shadow-sm" 
              : "text-slate-500 hover:text-slate-200 hover:bg-slate-800/60"
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          📈 Chronologischer Kursverlauf (14+ Tage Trend)
        </button>
      </div>

      {viewMode === "calendar" ? (
        <>
          {/* LINKER FLÜGEL: MONATLICHE HITMAP / KALENDER-MATRIX (2/3 Spalten) */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-sm flex flex-col lg:col-span-2">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-100" />
              📅 Kreativer Kalender & Microtiming-Historie
            </h3>
            <p className="text-xs text-slate-500 mt-1 italic font-serif">
              Sieh an welchen Tagen du aktiv warst und wie präzise deine Finger am Keyboard lagen.
            </p>
          </div>

          {/* Month Controller Pagination */}
          <div className="flex items-center gap-1.5 self-start sm:self-auto bg-slate-800 p-1 rounded border border-slate-700">
            <button 
              onClick={handlePrevMonth}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-750 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono font-bold text-slate-200 px-3 min-w-[100px] text-center">
              {GERMAN_MONTHS[calendarMonth]} 2026
            </span>
            <button 
              onClick={handleNextMonth}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-750 transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Legend Key */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-6 px-4 py-2.5 bg-slate-800/60 border border-slate-700 rounded text-[10px] font-mono text-slate-500">
          <span className="font-bold text-slate-300">Groove-Timing:</span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-emerald-900/300 border border-emerald-600 rounded"></span>
            Tight (&lt;9ms Drift)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-blue-900/300 border border-blue-600 rounded"></span>
            Groovy (9-17ms)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-[#d97706] border border-amber-600 rounded"></span>
            Loose/Swing (&gt;17ms)
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <span className="w-2.5 h-2.5 bg-slate-900 border border-slate-600 rounded"></span>
            Keine Session
          </span>
        </div>

        {/* MAIN CALENDAR GRID */}
        <div className="flex-1 select-none">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            {GERMAN_WEEKDAYS.map((wd, i) => (
              <div key={i} className="py-1">{wd.slice(0, 2)}</div>
            ))}
          </div>

          {/* Calendar Day Fields */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell, idx) => {
              const { dayNum, session } = cell;

              if (dayNum === null) {
                return (
                  <div 
                    key={`empty-${idx}`} 
                    className="aspect-square bg-slate-800/60/40 rounded-md border border-dotted border-slate-150"
                  />
                );
              }

              // Color determination
              let cellBg = "bg-slate-900 text-slate-200 border-slate-250 hover:border-slate-400";
              let badgeBg = "bg-slate-800 text-slate-500";
              let speedText = "";

              if (session) {
                speedText = `${session.tempo.toFixed(0)} BPM`;
                if (session.avgDriftMs < 9) {
                  cellBg = "bg-emerald-900/30 text-emerald-300 border-emerald-400 hover:bg-emerald-100/80 shadow-sm ring-1 ring-emerald-300";
                  badgeBg = "bg-emerald-800/40 text-emerald-300";
                } else if (session.avgDriftMs >= 9 && session.avgDriftMs <= 17) {
                  cellBg = "bg-blue-900/30 text-blue-300 border-blue-400 hover:bg-blue-100/80 shadow-sm ring-1 ring-blue-300";
                  badgeBg = "bg-blue-800/40 text-blue-300";
                } else if (session.avgDriftMs > 17 && session.avgDriftMs <= 30) {
                  cellBg = "bg-amber-900/30 text-amber-300 border-amber-400 hover:bg-amber-900/30/80 shadow-sm ring-1 ring-amber-300";
                  badgeBg = "bg-amber-900/30 text-amber-300";
                } else {
                  // DRIFT > 30ms WARNING STYLE
                  cellBg = "bg-rose-900/30 text-rose-300 border-rose-400 hover:bg-rose-900/30/80 shadow-sm ring-1 ring-rose-300 animate-[pulse_3s_infinite]";
                  badgeBg = "bg-rose-800/40 text-rose-300";
                }
              }

              const isClicked = selectedDaySession?.date === cell.dateString;
              if (isClicked) {
                cellBg += " ring-2 ring-slate-900 ring-offset-1";
              }

              return (
                <button
                  key={`day-${dayNum}`}
                  onClick={() => session && setSelectedDaySession(session)}
                  disabled={!session}
                  className={`aspect-square p-2 border rounded-md flex flex-col justify-between text-left transition-all relative ${
                    session ? 'cursor-pointer' : 'opacity-40 cursor-default font-normal'
                  } ${cellBg}`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-xs font-mono font-bold leading-none">{dayNum}</span>
                    {session && (
                      <span className={`text-[7.5px] px-1 font-mono rounded opacity-90 leading-tight flex items-center gap-0.5 ${session.avgDriftMs > 30 ? 'bg-rose-800/40 text-rose-300 font-extrabold border border-rose-300' : ''}`}>
                        {session.avgDriftMs > 30 && <AlertTriangle className="w-2.5 h-2.5 text-rose-300 animate-bounce shrink-0" />}
                        {session.avgDriftMs.toFixed(1)}ms
                      </span>
                    )}
                  </div>

                  {session ? (
                    <div className="flex flex-col gap-0.5 mt-auto text-[8px] font-mono leading-none tracking-tight">
                      <span className="font-semibold text-slate-100 truncate">
                        {session.fileName.includes("[") ? session.fileName.substring(session.fileName.indexOf("[") + 1, session.fileName.indexOf("]")) : "Sitzung"}
                      </span>
                      <span className="text-slate-500 font-medium">{speedText}</span>
                    </div>
                  ) : (
                    <span className="text-[7px] text-slate-300 font-mono mt-auto block">Offline</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Information Callout */}
        <div className="mt-6 flex gap-2.5 bg-slate-800/60 border border-slate-700 rounded p-4 text-[11px] leading-relaxed font-mono text-slate-400">
          <Info className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-slate-100">KALENDER-INTERAKTION:</span> Klicke auf ausgefüllte Kalendertage (Maikollektion ist prall befüllt!), um die exakten Timing-Spuren, BPM und Notenkomplexiät auszulesen. Nutze anschliessend den Lade-Button, um im Dashboard tiefer ins Piano Roll einzutauchen.
          </div>
        </div>
      </div>

      {/* RECHTER FLÜGEL: WOCHENTAGS_DRIFT ANALYSE & SESSION DETAIL ZOOM */}
      <div className="flex flex-col gap-6" id="weekday-detail-aside">
        
        {/* PANEL 1: WOCHENTAGS-VERGLEICHSTABELLE (Aggregierte Abweichung) */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-sm flex flex-col">
          <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono mb-4 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-slate-100" />
            📊 Wochentags-Timing im Vergleich
          </h3>

          <div className="space-y-4">
            {weekdayStats.map((item) => {
              const percentage = Math.min(100, (item.avgDrift / 25) * 100);
              
              let barColor = "bg-emerald-900/300";
              if (item.avgDrift > 8 && item.avgDrift <= 17) {
                barColor = "bg-blue-900/300";
              } else if (item.avgDrift > 17) {
                barColor = "bg-[#d97706]";
              }

              const isHighlighted = hoveredDayIdx === item.originalArrIndex;

              return (
                <div 
                  key={item.weekdayIdx} 
                  onMouseEnter={() => setHoveredDayIdx(item.originalArrIndex)}
                  onMouseLeave={() => setHoveredDayIdx(null)}
                  className={`font-mono text-[11px] border-b border-slate-800 pb-3 last:border-b-0 last:pb-0 transition-all p-1.5 rounded-md ${
                    isHighlighted ? "bg-slate-800/60 border-slate-600 shadow-sm scale-[1.02] -translate-x-1" : "border-transparent"
                  }`}
                >
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-slate-905">{item.name}</span>
                    <span className="text-[9.5px] text-slate-400">({item.count} Sessions)</span>
                  </div>

                  {item.count > 0 ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Timing ø {item.avgDrift.toFixed(1)} ms
                        </span>
                        <span className="text-slate-500 flex items-center gap-1">
                          <Percent className="w-2.5 h-2.5" />
                          Swing ø {item.avgSwing.toFixed(0)}%
                        </span>
                      </div>

                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${barColor} rounded-full transition-all duration-500`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-[9px] text-slate-400 italic py-1">Undokumentiert — Keine Midi Sessions</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PANEL 2: ZOOM FOKUS DAY CARD DETAILS */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-sm flex flex-col justify-between min-h-[220px]">
          <div>
            <h3 className="text-xs font-bold tracking-widest text-[#1a1a1a] uppercase font-mono mb-3">
              🔍 Detailansicht & Schnell-Transfer
            </h3>
            
            {selectedDaySession ? (
              <div className="space-y-3 font-mono text-[11px] bg-slate-800/60 border border-slate-700 rounded p-4">
                <div className="border-b border-slate-700 pb-2 flex justify-between items-center">
                  <span className="font-bold text-slate-100 text-xs">
                    {new Date(selectedDaySession.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                  <span className="text-[8px] bg-slate-250 text-slate-300 font-bold px-1.5 py-0.5 rounded uppercase">
                    LIVE_ALS
                  </span>
                </div>

                <div className="space-y-2 py-1">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Dateiname:</span>
                    <span className="text-slate-100 font-bold text-[9.5px] truncate max-w-[160px]" title={selectedDaySession.fileName}>
                      {selectedDaySession.fileName}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Projekttempo:</span>
                    <span className="text-slate-100 font-bold flex items-center gap-0.5">
                      <Music className="w-3 h-3 text-slate-450" />
                      {selectedDaySession.tempo} BPM
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-slate-400">
                    <span>Midi Notenanzahl:</span>
                    <span className="text-slate-100 font-bold">
                      {selectedDaySession.notesCount} Events
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-slate-400">
                    <span>Mittlere Drift:</span>
                    <span className={`font-bold flex items-center gap-1.5 ${
                      selectedDaySession.avgDriftMs < 9 
                        ? 'text-emerald-300' 
                        : selectedDaySession.avgDriftMs > 30 
                        ? 'text-rose-600 font-extrabold animate-pulse' 
                        : selectedDaySession.avgDriftMs > 17 
                        ? 'text-amber-300' 
                        : 'text-blue-300'
                    }`}>
                      {selectedDaySession.avgDriftMs > 30 && <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-bounce shrink-0" />}
                      {selectedDaySession.avgDriftMs.toFixed(2)} ms
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-slate-400">
                    <span>Swingfaktor 16Tel:</span>
                    <span className="text-slate-100 font-bold">
                      {selectedDaySession.swingFactor16th.toFixed(1)} %
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleFocusSessionInDashboard(selectedDaySession)}
                  className="w-full mt-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-3 text-[10.5px] rounded border border-slate-950 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5 animate-pulse" />
                  IM DASHBOARD TIETHER ANALYSIEREN
                </button>
              </div>
            ) : (
              <div className="h-full flex flex-col justify-center items-center text-center text-slate-400 p-5 mt-4 border border-dashed border-slate-700 rounded">
                <Calendar className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs">Kein Tag vorfokussiert.</p>
                <p className="text-[9.5px] mt-1 italic opacity-85 leading-normal">
                  Sitzungen sind als farbige Kacheln im Kalender hinterlegt. Klicke auf eine Kachel, um die Detailanalyse zu starten.
                </p>
              </div>
            )}
          </div>

          {/* Golden KPI stats at bottom */}
          {highlights && (
            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-700 text-slate-400 font-mono text-[9px]">
              <div className="bg-slate-800/60 p-2.5 rounded border border-slate-150">
                <span className="text-slate-400 font-medium block uppercase text-[7.5px] leading-tight">Groove Spitzenreiter</span>
                <span className="font-bold text-slate-850 block mt-0.5">{highlights.tightest.name}</span>
                <span className="text-emerald-600 text-[8.5px] font-bold">ø {highlights.tightest.avgDrift.toFixed(1)} ms Drift</span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded border border-slate-150">
                <span className="text-slate-400 font-medium block uppercase text-[7.5px] leading-tight">Beat Swing König</span>
                <span className="font-bold text-slate-850 block mt-0.5">{highlights.swingiest.name}</span>
                <span className="text-blue-400 text-[8.5px] font-bold">ø {highlights.swingiest.avgSwing.toFixed(0)}% Swing</span>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* --- NEUE SEKTION: WOCHENTAGS_CORRELATION (DIAGRAMM & TABELLE GEKOPPELT) --- */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-sm lg:col-span-3 flex flex-col lg:flex-row gap-6 mt-2" id="weekday-correlation-analysis">
        
        {/* LEFTSIDE CHART CONTAINER */}
        <div className="flex-1 shrink-0 bg-slate-800/60 border border-slate-700 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700">
            <div>
              <h4 className="text-[11px] font-bold font-mono text-slate-100 uppercase tracking-widest flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                📈 Timing-Drift vs. Projekttempo nach Wochentag
              </h4>
              <p className="text-[9.5px] text-slate-500 font-serif mt-0.5 italic">
                Zusammenhang zwischen Song-Geschwindigkeit (BPM) und Timing-Ungenauigkeit (Drift in ms).
              </p>
            </div>
            
            {/* Legend indicators */}
            <div className="flex gap-3 text-[9px] font-mono">
              <span className="flex items-center gap-1">
                <span className="w-3 h-1.5 bg-indigo-800/40 border border-indigo-400 rounded-sm"></span>
                ø Tempo (BPM, l. Achse)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-emerald-900/300 relative flex items-center justify-center">
                  <span className="w-1.5 h-1.5 bg-emerald-900/300 rounded-full"></span>
                </span>
                ø Drift (ms, r. Achse)
              </span>
            </div>
          </div>

          <div className="relative w-full overflow-hidden">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto font-mono text-[9px] select-none">
              
              {/* Horizontal Help Ticks Lines */}
              <line x1={paddingLeft} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop} stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1={paddingLeft} y1={paddingTop + chartH * 0.25} x2={svgWidth - paddingRight} y2={paddingTop + chartH * 0.25} stroke="#f1f5f9" />
              <line x1={paddingLeft} y1={paddingTop + chartH * 0.5} x2={svgWidth - paddingRight} y2={paddingTop + chartH * 0.5} stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1={paddingLeft} y1={paddingTop + chartH * 0.75} x2={svgWidth - paddingRight} y2={paddingTop + chartH * 0.75} stroke="#f1f5f9" />
              <line x1={paddingLeft} y1={paddingTop + chartH} x2={svgWidth - paddingRight} y2={paddingTop + chartH} stroke="#bfdbfe" strokeWidth="1.5" />

              {/* Left Y-Axis (Tempo) */}
              <text x={paddingLeft - 10} y={paddingTop + 3} textAnchor="end" fill="#6366f1" className="font-bold text-[8.5px]">160 BPM</text>
              <text x={paddingLeft - 10} y={paddingTop + chartH * 0.5 + 3} textAnchor="end" fill="#4f46e5">110 BPM</text>
              <text x={paddingLeft - 10} y={paddingTop + chartH + 3} textAnchor="end" fill="#6366f1" className="font-bold text-[8.5px]">60 BPM</text>

              {/* Right Y-Axis (Drift) */}
              <text x={svgWidth - paddingRight + 10} y={paddingTop + 3} textAnchor="start" fill="#10b981" className="font-bold text-[8.5px]">25 ms</text>
              <text x={svgWidth - paddingRight + 10} y={paddingTop + chartH * 0.5 + 3} textAnchor="start" fill="#059669">12.5 ms</text>
              <text x={svgWidth - paddingRight + 10} y={paddingTop + chartH + 3} textAnchor="start" fill="#10b981" className="font-bold text-[8.5px]">0 ms</text>

              {/* Tempo Bars Layer */}
              {weekdayStats.map((item, idx) => {
                if (item.count === 0) return null;
                const barWidth = 26;
                const x = xCoords[idx] - barWidth / 2;
                const y = getTempoY(item.avgTempo);
                const h = (paddingTop + chartH) - y;
                const isHovered = hoveredDayIdx === idx;

                return (
                  <g key={`tempo-bar-svg-${idx}`}>
                    {/* Background hover guide area */}
                    <rect
                      x={xCoords[idx] - (chartW / 12)}
                      y={paddingTop}
                      width={chartW / 6}
                      height={chartH}
                      fill={isHovered ? "rgba(224, 231, 255, 0.25)" : "transparent"}
                      className="transition-all duration-150 cursor-pointer"
                      onMouseEnter={() => setHoveredDayIdx(idx)}
                      onMouseLeave={() => setHoveredDayIdx(null)}
                    />
                    
                    {/* Actual data bar */}
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={h}
                      fill={isHovered ? "#6366f1" : "#c7d2fe"}
                      rx="3"
                      className="transition-colors duration-200 cursor-pointer"
                      onMouseEnter={() => setHoveredDayIdx(idx)}
                      onMouseLeave={() => setHoveredDayIdx(null)}
                    />

                    {/* Tempo text centered on top of bar on hover */}
                    {isHovered && (
                      <text
                        x={xCoords[idx]}
                        y={Math.max(paddingTop - 4, y - 6)}
                        textAnchor="middle"
                        fill="#312e81"
                        className="font-bold text-[8.5px]"
                      >
                        {item.avgTempo.toFixed(1)} BPM
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Drift line drawing */}
              {activeDriftPoints.length > 1 && (
                <path
                  d={activeDriftPoints.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Drift Circles Layer */}
              {activeDriftPoints.map((pt, idx) => {
                const isHovered = hoveredDayIdx === pt.originalIndex;

                return (
                  <g key={`drift-node-svg-${idx}`}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 6 : 4}
                      fill={isHovered ? "#34d399" : "#10b981"}
                      stroke="#ffffff"
                      strokeWidth={2}
                      className="cursor-pointer transition-all duration-150"
                      onMouseEnter={() => setHoveredDayIdx(pt.originalIndex)}
                      onMouseLeave={() => setHoveredDayIdx(null)}
                    />

                    {/* Popover timing card on hover */}
                    {isHovered && (
                      <g>
                        <rect
                          x={pt.x - 28}
                          y={pt.y - 22}
                          width="56"
                          height="14"
                          fill="#065f46"
                          rx="3"
                          className="shadow-sm"
                        />
                        <text
                          x={pt.x}
                          y={pt.y - 12}
                          textAnchor="middle"
                          fill="#ffffff"
                          className="text-[8px] font-bold"
                        >
                          {pt.drift.toFixed(1)} ms Drift
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* X-Axis bottom labels */}
              {weekdayStats.map((item, idx) => {
                const isHovered = hoveredDayIdx === idx;
                
                return (
                  <g key={`x-axis-lbl-${idx}`}>
                    <text
                      x={xCoords[idx]}
                      y={paddingTop + chartH + 16}
                      textAnchor="middle"
                      fill={isHovered ? "#4f46e5" : "#475569"}
                      className={`text-[9.5px] font-mono tracking-wider font-bold uppercase transition-colors ${
                        isHovered ? 'underline' : ''
                      }`}
                    >
                      {item.shortName}
                    </text>
                    <text
                      x={xCoords[idx]}
                      y={paddingTop + chartH + 28}
                      textAnchor="middle"
                      fill="#94a3b8"
                      className="text-[7.5px]"
                    >
                      {item.count > 0 ? `${item.count} S.` : "—"}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* RIGHTSIDE TABLE & COOPERATIVE ADVISORY (DIAGNOSIS CARD) */}
        <div className="w-full lg:w-[460px] flex flex-col justify-between" id="weekday-table-insights">
          
          {/* COMPARISON STATISTICS TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-[10.5px]">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
                  <th className="pb-2">Wochentag</th>
                  <th className="pb-2 text-center">Spuren</th>
                  <th className="pb-2 text-right">Tempo (BPM)</th>
                  <th className="pb-2 text-right">Drift (ms)</th>
                  <th className="pb-2 text-right">Groove Type</th>
                </tr>
              </thead>
              <tbody>
                {weekdayStats.map((item) => {
                  const isHighlighted = hoveredDayIdx === item.originalArrIndex;
                  
                  // Groove evaluation wording
                  let grooveType = "Ruhetag";
                  let grooveColor = "text-slate-400";
                  
                  if (item.count > 0) {
                    if (item.avgDrift < 9) {
                      grooveType = "Metronomisch";
                      grooveColor = "text-emerald-600 font-bold";
                    } else if (item.avgDrift >= 9 && item.avgDrift <= 14) {
                      grooveType = "Classic Tight";
                      grooveColor = "text-emerald-500";
                    } else if (item.avgDrift > 14 && item.avgDrift <= 18) {
                      grooveType = "Laid-back";
                      grooveColor = "text-blue-400";
                    } else {
                      grooveType = "Heavy Swing";
                      grooveColor = "text-amber-400 font-semibold";
                    }
                  }

                  return (
                    <tr 
                      key={`list-row-${item.weekdayIdx}`}
                      onMouseEnter={() => setHoveredDayIdx(item.originalArrIndex)}
                      onMouseLeave={() => setHoveredDayIdx(null)}
                      className={`border-b border-slate-800 last:border-b-0 transition-colors duration-150 cursor-pointer ${
                        isHighlighted ? "bg-indigo-900/30/70" : ""
                      }`}
                    >
                      <td className="py-2.5 font-bold text-slate-200">
                        {item.name}
                      </td>
                      <td className="py-2.5 text-center text-slate-500">
                        {item.count}
                      </td>
                      <td className="py-2.5 text-right font-medium text-slate-100">
                        {item.count > 0 ? `${item.avgTempo.toFixed(0)} BPM` : "—"}
                      </td>
                      <td className="py-2.5 text-right font-bold text-indigo-300">
                        {item.count > 0 ? `${item.avgDrift.toFixed(1)} ms` : "—"}
                      </td>
                      <td className={`py-2.5 text-right text-[9.5px] ${grooveColor}`}>
                        {grooveType}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* MEDICAL/MUSICOLOGICAL FEEDBACK COACH CARD */}
          {dynamicDisciplineInsights && (
            <div className="mt-4 bg-slate-950 text-white rounded-lg p-4 border border-slate-800 shadow-sm font-mono relative overflow-hidden">
              <div className="absolute right-3 top-3 opacity-15">
                <Flame className="w-16 h-16 text-indigo-400 animate-pulse" />
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] bg-indigo-900/300 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  Disziplin-Score: {dynamicDisciplineInsights.score}
                </span>
                <span className="text-[10px] text-slate-400">
                  Kategorie: {dynamicDisciplineInsights.category}
                </span>
              </div>

              <h5 className="text-[11.5px] font-bold text-indigo-300 leading-tight">
                {dynamicDisciplineInsights.title}
              </h5>
              
              <p className="text-[10px] text-slate-300 mt-2 leading-relaxed font-serif italic">
                "{dynamicDisciplineInsights.text}"
              </p>

              <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 gap-2 text-[8.5px] text-slate-400">
                <div>
                  <span className="block uppercase text-[7.5px] text-slate-400 font-bold">Produktivster Tag:</span>
                  <span className="text-white text-[9.5px] font-bold">{dynamicDisciplineInsights.maxSessionsDay?.name} ({dynamicDisciplineInsights.maxSessionsDay?.count} Sessions)</span>
                </div>
                <div>
                  <span className="block uppercase text-[7.5px] text-slate-400 font-bold">Bestes Timing (Drift):</span>
                  <span className="text-emerald-400 text-[9.5px] font-bold">{dynamicDisciplineInsights.tightestDay?.name} (ø {dynamicDisciplineInsights.tightestDay?.avgDrift.toFixed(1)}ms)</span>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </>
  ) : (
    <div className="lg:col-span-3 flex flex-col gap-6 animate-fade-in w-full">
      
      {/* KPI Dashboard Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full">
        <div className="bg-slate-900 border border-slate-700 p-5 rounded-lg shadow-sm font-mono flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Gefilmte Einheiten</span>
            <span className="text-3xl font-extrabold text-slate-100 block mt-1">{sortedSessions.length}</span>
          </div>
          <p className="text-[9.5px] text-slate-500 mt-2 font-serif italic">14 Unterrichtstage als chronologisches Logbuch.</p>
        </div>

        <div className="bg-slate-900 border border-slate-700 p-5 rounded-lg shadow-sm font-mono flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Timing-Progression (Lern-Kurve)</span>
            {sortedSessions.length >= 2 ? (
              <div>
                <span className="text-sm font-bold text-slate-100 block mt-1 leading-normal">
                  {sortedSessions[0].avgDriftMs.toFixed(1)}ms <span className="text-slate-400 font-normal">→</span> {sortedSessions[sortedSessions.length - 1].avgDriftMs.toFixed(1)}ms
                </span>
                {sortedSessions[0].avgDriftMs > sortedSessions[sortedSessions.length - 1].avgDriftMs ? (
                  <span className="text-emerald-600 text-[10px] font-bold">
                    ▲ {(( (sortedSessions[0].avgDriftMs - sortedSessions[sortedSessions.length-1].avgDriftMs) / sortedSessions[0].avgDriftMs ) * 100).toFixed(0)}% präziser gespielt!
                  </span>
                ) : (
                  <span className="text-slate-500 text-[10px]">Stabile Timing-Konstanz</span>
                )}
              </div>
            ) : (
              <span className="text-sm font-bold text-slate-400 block mt-1">Nicht genügend Daten</span>
            )}
          </div>
          <p className="text-[9.5px] text-slate-500 mt-1 font-serif italic">Entwicklung deiner mittleren Anschlags-Verzögerung.</p>
        </div>

        <div className="bg-slate-900 border border-slate-700 p-5 rounded-lg shadow-sm font-mono flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Gespielter Frequenzbereich</span>
            {sortedSessions.length > 0 ? (
              <div>
                <span className="text-2xl font-extrabold text-indigo-600 block mt-1">
                  {sortedSessions.reduce((a, s) => Math.min(a, s.estimatedBpm || s.tempo), Infinity).toFixed(0)} - {sortedSessions.reduce((a, s) => Math.max(a, s.estimatedBpm || s.tempo), -Infinity).toFixed(0)} BPM
                </span>
                <span className="text-[9px] text-slate-500">Auto-detektierte Pulse ohne Live Click!</span>
              </div>
            ) : (
              <span className="text-sm font-bold text-slate-400 block mt-1">—</span>
            )}
          </div>
          <p className="text-[9.5px] text-slate-500 mt-2 font-serif italic">Gefundene physische Tempi aus Anschlags-Intervallen.</p>
        </div>

        <div className="bg-slate-900 border border-slate-700 p-5 rounded-lg shadow-sm font-mono flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Vielfalt & Stilbalance</span>
            {sortedSessions.length > 0 ? (
              <div className="text-xs font-bold text-slate-200 space-y-1 mt-1">
                <div className="flex justify-between">
                  <span className="text-emerald-600">Melodisch:</span>
                  <span>{sortedSessions.filter(s => s.styleCategory === "Melodisch").length} S.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-indigo-600">Harmonisch:</span>
                  <span>{sortedSessions.filter(s => s.styleCategory === "Harmonisch").length} S.</span>
                </div>
              </div>
            ) : (
              <span className="text-sm font-bold text-slate-400 block mt-1">—</span>
            )}
          </div>
          <p className="text-[9.5px] text-slate-500 mt-2 font-serif italic">Aufteilung zwischen Single-Note und Chordal-Spielen.</p>
        </div>
      </div>

      {/* MAIN GRAPH: PULSE VS NOMINAL BPM */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-sm flex flex-col">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-6 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              🎵 Das Metronom-Geheimnis: Wahrer Puls vs. Projekt-Tempo (Silent Click)
            </h3>
            <p className="text-xs text-slate-500 font-serif mt-1 italic">
              Weil der Klick stumm lief, zeigt diese Grafik, welches Spieltempo (Puls) die Noten-Timings wirklich tragen.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono">
            <span className="flex items-center gap-1.5 text-indigo-600 font-bold">
              <span className="w-3 h-3 bg-[#6366f1] rounded-full border-2 border-white"></span>
              Gefundener Puls (Playing BPM)
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="w-3 h-0.5 border-t border-dashed border-slate-400"></span>
              Projekttempo (Nominal 120)
            </span>
          </div>
        </div>

        {sortedSessions.length === 0 ? (
          <div className="py-12 text-center text-slate-400 font-mono text-xs">
            Keine Sessions vorhanden. Bitte lade Beispieldaten, um die Progression einzusehen!
          </div>
        ) : (
          <div className="w-full relative overflow-hidden bg-slate-800/60 p-4 border border-slate-700 rounded-lg">
            <svg viewBox="0 0 800 240" className="w-full h-auto font-mono text-[9px] select-none">
              <line x1="50" y1="30" x2="750" y2="30" stroke="#f1f5f9" />
              <line x1="50" y1="80" x2="750" y2="80" stroke="#f1f5f9" />
              <line x1="50" y1="130" x2="750" y2="130" stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1="50" y1="180" x2="750" y2="180" stroke="#f1f5f9" />
              <line x1="50" y1="210" x2="750" y2="210" stroke="#bfdbfe" strokeWidth="1.5" />

              <text x="40" y="34" textAnchor="end" fill="#64748b">160</text>
              <text x="40" y="134" textAnchor="end" fill="#4f46e5" className="font-bold">110 BPM</text>
              <text x="40" y="214" textAnchor="end" fill="#64748b">60</text>

              {(() => {
                const chartWidth = 700;
                const chartHeight = 180;
                const stepX = sortedSessions.length > 1 ? chartWidth / (sortedSessions.length - 1) : 0;

                const pointsNominal: string[] = [];
                const pointsEstimated: string[] = [];
                const coords: { x: number; yEst: number; yNom: number; s: AlsFileStats; idx: number }[] = [];

                sortedSessions.forEach((s, idx) => {
                  const x = 50 + idx * stepX;
                  const nominalY = 210 - ((s.tempo - 60) / 100) * chartHeight;
                  const estVal = s.estimatedBpm || s.tempo;
                  const estimatedY = 210 - ((estVal - 60) / 100) * chartHeight;

                  pointsNominal.push(`${x},${nominalY}`);
                  pointsEstimated.push(`${x},${estimatedY}`);
                  coords.push({ x, yEst: estimatedY, yNom: nominalY, s, idx });
                });

                return (
                  <g>
                    {coords.length > 1 && (
                      <path
                        d={`M ${coords[0].x} 210 L ${coords.map(c => `${c.x} ${c.yEst}`).join(' L ')} L ${coords[coords.length - 1].x} 210 Z`}
                        fill="url(#pulseGradient)"
                        opacity="0.08"
                      />
                    )}

                    {coords.length > 1 && (
                      <path
                        d={`M ${pointsNominal.join(' L ')}`}
                        fill="none"
                        stroke="#cbd5e1"
                        strokeWidth="1.5"
                        strokeDasharray="4,4"
                      />
                    )}

                    {coords.length > 1 && (
                      <path
                        d={`M ${pointsEstimated.join(' L ')}`}
                        fill="none"
                        stroke="#4f46e5"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {coords.map((c, i) => {
                      const isHovered = hoveredDayIdx === i;
                      const estBpmVal = c.s.estimatedBpm || c.s.tempo;
                      return (
                        <g key={`timeline-node-${i}`}>
                          <circle
                            cx={c.x}
                            cy={c.yEst}
                            r={isHovered ? 6 : 4}
                            fill={isHovered ? "#6366f1" : "#4f46e5"}
                            stroke="#ffffff"
                            strokeWidth={2}
                            className="cursor-pointer transition-all duration-150"
                            onMouseEnter={() => setHoveredDayIdx(i)}
                            onMouseLeave={() => setHoveredDayIdx(null)}
                            onClick={() => handleFocusSessionInDashboard(c.s)}
                          />

                          {isHovered && (
                            <g>
                              <rect
                                x={c.x - 45}
                                y={c.yEst - 28}
                                width="90"
                                height="18"
                                fill="#1e1b4b"
                                rx="3"
                                className="shadow"
                              />
                              <text
                                x={c.x}
                                y={c.yEst - 16}
                                textAnchor="middle"
                                fill="#ffffff"
                                className="font-mono text-[8px] font-bold"
                              >
                                Puls: {estBpmVal.toFixed(1)} BPM
                              </text>
                            </g>
                          )}

                          <text
                            x={c.x}
                            y="225"
                            textAnchor="middle"
                            fill="#475569"
                            className={`text-[8px] font-bold font-mono transition-colors ${isHovered ? 'fill-indigo-600 underline' : ''}`}
                          >
                            Tag {i + 1}
                          </text>
                          <text
                            x={c.x}
                            y="235"
                            textAnchor="middle"
                            fill="#94a3b8"
                            className="text-[7px]"
                          >
                            {c.s.date.split('-').slice(1).reverse().join('/')}
                          </text>
                        </g>
                      );
                    })}

                    <defs>
                      <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </g>
                );
              })()}
            </svg>
          </div>
        )}
      </div>

      {/* CHRONOLOGICAL LIST OF DAYS WITH SECTION DESCRIPTIONS */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-sm flex flex-col">
        <h3 className="text-xs font-bold tracking-widest text-[#1a1a1a] uppercase font-mono mb-4 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          🗂️ Lektionen-Logbuch & Detailauswertungen (Tag 1 bis {sortedSessions.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedSessions.map((session, sIdx) => {
            const isHovered = hoveredDayIdx === sIdx;
            const secAnalysis = getSectionAnalysis(session);
            const nominalBpm = session.tempo;
            const estBpm = session.estimatedBpm || session.tempo;
            
            return (
              <div
                key={session.fileName}
                onMouseEnter={() => setHoveredDayIdx(sIdx)}
                onMouseLeave={() => setHoveredDayIdx(null)}
                className={`border rounded-lg p-4 font-mono transition-all duration-200 ${
                  isHovered 
                    ? 'border-indigo-400 bg-indigo-900/30/20 shadow-sm scale-[1.01] -translate-y-0.5' 
                    : 'border-slate-700 bg-slate-800/60/40'
                }`}
              >
                <div className="flex justify-between items-center border-b border-slate-700 pb-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] bg-indigo-600 text-white font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Tag {sIdx + 1}
                    </span>
                    <span className="font-bold text-xs text-slate-200">
                      {new Date(session.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                  <span className="text-[8px] text-slate-400 text-right truncate max-w-[124px]" title={session.fileName}>
                    {session.fileName}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 border-b border-dashed border-slate-700 pb-2 mb-2">
                  <div>
                    <span className="text-[8px] text-slate-400 block uppercase font-bold">Gefundener Puls:</span>
                    <span className="text-slate-100 font-bold text-xs">{estBpm.toFixed(1)} BPM</span>
                    <span className="text-[7.5px] text-slate-400 block">Nominal: {nominalBpm} BPM</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 block uppercase font-bold">Microtiming Drift:</span>
                    <span className={`font-bold text-xs flex items-center gap-1 ${session.avgDriftMs > 30 ? 'text-rose-600 animate-[pulse_2s_infinite]' : 'text-indigo-300'}`}>
                      {session.avgDriftMs > 30 && <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-bounce" />}
                      {session.avgDriftMs.toFixed(1)} ms
                    </span>
                    <span className="text-[7.5px] text-slate-400 block">
                      Kompensation: {
                        session.avgDriftMs < 9 
                          ? 'Exzellent' 
                          : session.avgDriftMs > 30 
                          ? '⚠️ Hoher Driftwert!' 
                          : session.avgDriftMs > 17 
                          ? 'Grenzbereich' 
                          : 'Lockere Balance'
                      }
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 block uppercase font-bold">Strukturtyp:</span>
                    <span className="text-indigo-300 font-bold">{session.structureCategory || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 block uppercase font-bold">Stilstufe (Midi):</span>
                    <span className="text-emerald-300 font-bold">{session.styleCategory || '—'}</span>
                  </div>
                </div>

                <div className="space-y-1 text-[9.5px]">
                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Typische Muster nach Abschnitten:</span>
                  
                  <div className="grid grid-cols-1 gap-1.5 bg-slate-900 border border-slate-700 rounded p-2 text-[9px] text-slate-300">
                    <div className="flex gap-1.5 items-start">
                      <span className="text-slate-400 font-bold min-w-[32px]">Beginn:</span>
                      <span className="italic">{secAnalysis.intro}</span>
                    </div>
                    <div className="flex gap-1.5 items-start">
                      <span className="text-slate-400 font-bold min-w-[32px]">Mitte:</span>
                      <span className="italic">{secAnalysis.mid}</span>
                    </div>
                    <div className="flex gap-1.5 items-start">
                      <span className="text-slate-400 font-bold min-w-[32px]">Schluss:</span>
                      <span className="italic">{secAnalysis.outro}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleFocusSessionInDashboard(session)}
                  className="w-full mt-3 bg-slate-900 border border-slate-950 hover:bg-slate-800 text-white font-bold py-1 px-2 text-[9.5px] rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Activity className="w-3 h-3 text-indigo-400" />
                  Piano-Roll und Microtimings einsehen
                </button>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  )}

</div>
  );
};

// --- HILFSFUNKTION FÜR SEKTIONS-ANALYSEN ---
function getSectionAnalysis(session: AlsFileStats) {
  const notes = session.notes;
  if (!notes || notes.length === 0) {
    return { intro: "Keine MIDI-Noten vorhanden", mid: "Keine MIDI-Noten vorhanden", outro: "Keine MIDI-Noten vorhanden" };
  }

  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const totalDuration = sorted[sorted.length - 1].time;

  const third1 = totalDuration / 3;
  const third2 = (totalDuration * 2) / 3;

  const introNotes = sorted.filter(n => n.time < third1);
  const midNotes = sorted.filter(n => n.time >= third1 && n.time < third2);
  const outroNotes = sorted.filter(n => n.time >= third2);

  const getIntensityText = (nList: typeof notes) => {
    if (nList.length === 0) return "Keine Tastenanschläge in dieser Phase.";
    const totalVel = nList.reduce((sum, n) => sum + n.velocity, 0);
    const avgVel = totalVel / nList.length;
    let velocityDesc = "";
    if (avgVel < 80) velocityDesc = "Feinfühliger, sanfter Anschlag (Piano)";
    else if (avgVel < 105) velocityDesc = "Ausgewogene Spieldynamik (Mezzo-Forte)";
    else velocityDesc = "Energetischer, kräftiger Ausbruch (Forte)";
    
    const minPitch = nList.reduce((a, n) => Math.min(a, n.key), Infinity);
    const maxPitch = nList.reduce((a, n) => Math.max(a, n.key), -Infinity);
    
    let pitchDesc = "Mittellage";
    if (maxPitch - minPitch > 24) {
      pitchDesc = "Großer Tonumfang (Akkorde & Melodie weit gespreizt)";
    } else if (minPitch < 48) {
      pitchDesc = "Tiefe Tonlage (Fokus auf Bassfundament / Harmonie)";
    } else if (maxPitch > 72) {
      pitchDesc = "Hohe Lage (Fokus auf Melodieführung / Solospiel)";
    }

    return `${velocityDesc}, ${pitchDesc} (${nList.length} Noten)`;
  };

  return {
    intro: getIntensityText(introNotes),
    mid: getIntensityText(midNotes),
    outro: getIntensityText(outroNotes)
  };
}
