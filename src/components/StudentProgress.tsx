import React, { useState, useMemo, useCallback, Fragment } from 'react';
import { AlsFileStats, ScheduleEntry } from '../types';
import { User, Edit3, Save, Upload, Download, RefreshCw, Info, ChevronDown, ChevronRight, Search, Calendar, BarChart3 } from 'lucide-react';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function matchStudentByWeekday(
  session: AlsFileStats,
  schedule: ScheduleEntry[],
  counter: Map<number, number>
): string | null {
  const slots = schedule.filter(e => e.weekday === session.weekday);
  if (slots.length === 0) return null;
  const idx = counter.get(session.weekday) ?? 0;
  counter.set(session.weekday, idx + 1);
  return slots[idx % slots.length].studentName;
}

function anonymizeNames(schedule: ScheduleEntry[]): ScheduleEntry[] {
  const seen = new Map<string, string>();
  let counter = 1;
  const usedNames = new Set<string>();
  for (const e of schedule) {
    if (e.studentName && !seen.has(e.studentName)) {
      let name = 'Schüler ' + counter;
      while (usedNames.has(name)) {
        counter++;
        name = 'Schüler ' + counter;
      }
      seen.set(e.studentName, name);
      usedNames.add(name);
      counter++;
    }
  }
  return schedule.map(e => ({
    ...e,
    studentName: seen.get(e.studentName) ?? e.studentName,
  }));
}

const METRIC_INFO: Record<string, {
  label: string; unit: string; description: string;
  good?: string; medium?: string; bad?: string;
  goodColor?: string; mediumColor?: string; badColor?: string;
  barColor?: (val: number) => string;
  higherIsBetter?: boolean;
}> = {
  drift: {
    label: 'Timing-Drift', unit: 'ms',
    description: 'Durchschnittliche Abweichung vom Grid. Niedriger = präziser.',
    good: '< 12 ms', medium: '12–20 ms', bad: '> 20 ms',
    goodColor: 'text-emerald-400', mediumColor: 'text-amber-400', badColor: 'text-red-400',
    barColor: (v: number) => v < 12 ? 'bg-emerald-500' : v < 20 ? 'bg-amber-500' : 'bg-red-500',
    higherIsBetter: false,
  },
  bpm: {
    label: 'Tempo (BPM)', unit: 'BPM',
    description: 'Geschätztes Tempo. Zeigt Tempostabilität über die Zeit.',
  },
  velocity: {
    label: 'Anschlagsstärke', unit: '',
    description: 'Mittlere Velocity (0–127). Gleichmäßigkeit der Dynamik.',
  },
  focusScore: {
    label: 'Focus Score', unit: '',
    description: 'Gesamtqualität der Session (0–100).',
    good: '≥ 70', medium: '40–69', bad: '< 40',
    goodColor: 'text-emerald-400', mediumColor: 'text-amber-400', badColor: 'text-red-400',
    barColor: (v: number) => v >= 70 ? 'bg-emerald-500' : v >= 40 ? 'bg-amber-500' : 'bg-red-500',
    higherIsBetter: true,
  },
};

const ALL_METRICS = ['drift', 'bpm', 'velocity', 'focusScore'] as const;

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <Info className="w-3 h-3 text-slate-500 hover:text-slate-300 cursor-help ml-1" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-slate-900 text-slate-200 text-[9px] px-2 py-1 rounded border border-slate-700 whitespace-nowrap z-10 shadow-lg">
        {text}
      </span>
    </span>
  );
}

function MiniBarChart({ values, labels, barColor, good, medium, bad, unit }: {
  values: number[]; labels: string[]; barColor: (v: number) => string;
  good?: string; medium?: string; bad?: string; unit?: string;
}) {
  const maxVal = Math.max(...values, 1);
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-0.5 h-20">
        {values.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end items-center group/chart">
            <div
              className={`w-full rounded-t transition-all duration-200 ${barColor(v)}`}
              style={{ height: `${(v / maxVal) * 100}%`, minHeight: 2 }}
              title={`${labels[i]}: ${v}${unit ?? ''}`}
            />
            <span className="text-[7px] text-slate-600 mt-0.5 leading-tight">{labels[i]}</span>
          </div>
        ))}
      </div>
      {(good || medium || bad) && (
        <div className="flex gap-2 text-[8px] text-slate-500 justify-center">
          {good && <span className="text-emerald-500/70">{good}</span>}
          {medium && <span className="text-amber-500/70">{medium}</span>}
          {bad && <span className="text-red-500/70">{bad}</span>}
        </div>
      )}
    </div>
  );
}

function MetricCard({ sessions, metric }: { sessions: AlsFileStats[]; metric: typeof ALL_METRICS[number] }) {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const info = METRIC_INFO[metric];
  if (!info) return null;

  let labels: string[];
  let values: number[];
  let barColorFn = info.barColor ?? (() => 'bg-blue-500');

  switch (metric) {
    case 'drift':
      labels = sorted.map(s => s.date.slice(5));
      values = sorted.map(s => s.avgDriftMs);
      break;
    case 'bpm':
      labels = sorted.map(s => s.date.slice(5));
      values = sorted.map(s => s.estimatedBpm ?? s.tempo);
      break;
    case 'velocity':
      labels = sorted.map(s => s.date.slice(5));
      values = sorted.map(s => s.avgVelocity);
      break;
    case 'focusScore': {
      const withFocus = sorted.filter(s => s.focusScore != null);
      if (withFocus.length === 0) return null;
      labels = withFocus.map(s => s.date.slice(5));
      values = withFocus.map(s => s.focusScore!);
      break;
    }
    default:
      return null;
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const first = values[0];
  const last = values[values.length - 1];
  const trend = last - first;
  const trendStr = trend > 0
    ? `+${trend.toFixed(1)}${info.unit}`
    : `${trend.toFixed(1)}${info.unit}`;
  const isGood = info.higherIsBetter ? trend > 0 : trend < 0;

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{info.label}</span>
          <InfoTooltip text={info.description} />
        </div>
        <div className="flex items-center gap-2 text-[9px]">
          <span className="text-slate-500">Ø {avg.toFixed(1)}</span>
          <span className={`font-bold ${isGood ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend > 0 ? '↑' : '↓'} {trendStr}
          </span>
        </div>
      </div>
      <MiniBarChart
        values={values}
        labels={labels}
        barColor={barColorFn}
        good={info.good}
        medium={info.medium}
        bad={info.bad}
        unit={info.unit}
      />
    </div>
  );
}

function MetricExplanationHelp({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="bg-indigo-950/30 border border-indigo-800/30 rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-xs font-semibold text-slate-300 hover:text-slate-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-indigo-400" />
          Metrik-Erklärungen
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-[10px] text-slate-400">
          {Object.entries(METRIC_INFO).map(([key, info]) => (
            <div key={key} className="border-l-2 border-indigo-800/40 pl-2">
              <div className="font-bold text-slate-300">{info.label}</div>
              <p className="italic font-serif">{info.description}</p>
              {info.good && (
                <div className="flex gap-3 mt-0.5 text-[9px]">
                  <span className="text-emerald-500">Gut: {info.good}</span>
                  {info.medium && <span className="text-amber-500">Mittel: {info.medium}</span>}
                  {info.bad && <span className="text-red-500">Verbesserung: {info.bad}</span>}
                </div>
              )}
            </div>
          ))}
          <div className="border-l-2 border-indigo-800/40 pl-2">
            <div className="font-bold text-slate-300">Lehrer/Schüler-Aufteilung</div>
            <p className="italic font-serif">Vergleich von Lehrervorspiel und Schülerspiel innerhalb einer Session. Zeigt, wie viel der Schüler selbstständig spielt und wie präzise.</p>
          </div>
          <div className="border-l-2 border-indigo-800/40 pl-2">
            <div className="font-bold text-slate-300">Sessions-Anzahl</div>
            <p className="italic font-serif">Gesamtzahl der erfassten Übeeinheiten. Mehr Sessions = mehr Übung = bessere Lernkurve.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentCharts({ sessions }: { sessions: AlsFileStats[] }) {
  const n = sessions.length;
  if (n === 0) return null;

  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const avgBpm = sessions.reduce((a, s) => a + (s.estimatedBpm ?? s.tempo), 0) / n;
  const avgDrift = sessions.reduce((a, s) => a + s.avgDriftMs, 0) / n;
  const avgVel = Math.round(sessions.reduce((a, s) => a + s.avgVelocity, 0) / n);
  const avgFocus = Math.round(sessions.reduce((a, s) => a + (s.focusScore ?? 0), 0) / n);
  const drifts = sorted.map(s => s.avgDriftMs);
  const firstDrift = drifts.length > 0 ? drifts[0] : 0;
  const lastDrift = drifts.length > 0 ? drifts[drifts.length - 1] : 0;
  const driftChange = firstDrift > 0 ? ((firstDrift - lastDrift) / firstDrift * 100).toFixed(0) : '0';
  const driftImproving = Number(driftChange) > 0;

  const withSplit = sessions.filter(s => s.teacherStudentSplit);
  const withStudent = withSplit.filter(s => s.teacherStudentSplit && s.teacherStudentSplit.studentNoteCount > 0);
  const teacherDrift = withSplit.length > 0
    ? withSplit.reduce((a, s) => a + s.teacherStudentSplit!.teacherAvgDriftMs, 0) / withSplit.length
    : 0;
  const studentDrift = withStudent.length > 0
    ? withStudent.reduce((a, s) => a + s.teacherStudentSplit!.studentAvgDriftMs, 0) / withStudent.length
    : 0;
  const studentPct = withSplit.length > 0
    ? withSplit.reduce((a, s) => a + (s.teacherStudentSplit!.studentNoteCount / Math.max(1, s.notesCount)) * 100, 0) / withSplit.length
    : 0;

  const driftStatus = avgDrift < 12 ? 'text-emerald-400' : avgDrift < 20 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50 text-center">
          <div className="text-[8px] text-slate-400 uppercase font-black">Sessions</div>
          <div className="text-sm font-bold text-white">{n}</div>
          <div className="text-[7px] text-slate-600">Übungseinheiten</div>
        </div>
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50 text-center">
          <div className="text-[8px] text-slate-400 uppercase font-black">Trend</div>
          <div className={`text-sm font-bold ${driftImproving ? 'text-emerald-400' : 'text-red-400'}`}>
            {driftImproving ? '↓' : '↑'} {Math.abs(Number(driftChange))}%
          </div>
          <div className="text-[7px] text-slate-600">Drift-Verbesserung</div>
        </div>
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50 text-center">
          <div className="text-[8px] text-slate-400 uppercase font-black">Drift Ø</div>
          <div className={`text-sm font-bold ${driftStatus}`}>{avgDrift.toFixed(1)}ms</div>
          <div className="text-[7px] text-slate-600">Timing-Präzision</div>
        </div>
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50 text-center">
          <div className="text-[8px] text-slate-400 uppercase font-black">BPM Ø</div>
          <div className="text-sm font-bold text-white">{avgBpm.toFixed(0)}</div>
          <div className="text-[7px] text-slate-600">Ø Tempo</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {ALL_METRICS.map(m => (
          <Fragment key={m}>
            <MetricCard sessions={sessions} metric={m} />
          </Fragment>
        ))}
      </div>

      {withSplit.length > 0 && (
        <div className="text-[10px] bg-amber-900/20 border border-amber-800/30 rounded p-2 space-y-1">
          <div className="font-semibold text-slate-300 flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            Lehrer/Schüler-Aufteilung
          </div>
          <div className="flex flex-wrap gap-3 text-slate-300">
            <span>Lehrer-Drift Ø <span className="font-bold text-emerald-400">{teacherDrift.toFixed(1)} ms</span></span>
            <span>Schüler-Drift Ø <span className="font-bold text-amber-400">{studentDrift.toFixed(1)} ms</span></span>
            <span>Schüler-Anteil Ø <span className="font-bold text-blue-400">{studentPct.toFixed(0)}%</span></span>
          </div>
          <div className="text-[9px] text-slate-500 italic font-serif">
            {studentDrift < teacherDrift * 1.2
              ? 'Schüler spielt fast so präzise wie der Lehrer – sehr gut!'
              : 'Schüler benötigt noch Übung – der Lehrer zeigt vor.'}
          </div>
        </div>
      )}

      <div className="text-[9px] text-slate-600 grid grid-cols-5 gap-2 pt-1 border-t border-slate-700/30">
        <span>{n} Sessions</span>
        <span>BPM Ø {avgBpm.toFixed(1)}</span>
        <span>Drift Ø {avgDrift.toFixed(1)} ms</span>
        <span>Velocity Ø {avgVel}</span>
        <span>Focus Ø {avgFocus}</span>
      </div>
    </div>
  );
}

interface Props {
  sessions: AlsFileStats[];
  schedule: ScheduleEntry[];
  onScheduleChange: (s: ScheduleEntry[]) => void;
}

export function StudentProgress({ sessions, schedule, onScheduleChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [editSchedule, setEditSchedule] = useState<ScheduleEntry[]>(() => [...schedule]);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [studentFilter, setStudentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const studentGroups = useMemo(() => {
    const map = new Map<string, AlsFileStats[]>();
    const unmatched: AlsFileStats[] = [];
    const weekdayCounter = new Map<number, number>();
    for (const s of sessions) {
      const name = matchStudentByWeekday(s, schedule, weekdayCounter);
      if (name) {
        if (!map.has(name)) map.set(name, []);
        const match = schedule.find(e => e.studentName === name);
        map.get(name)!.push(match && match.time !== s.time ? { ...s, time: match.time } : s);
      } else {
        unmatched.push(s);
      }
    }
    if (unmatched.length > 0) {
      const wdMap = new Map<string, AlsFileStats[]>();
      for (const s of unmatched) {
        const key = `${WEEKDAYS[s.weekday]} (unzugeordnet)`;
        if (!wdMap.has(key)) wdMap.set(key, []);
        wdMap.get(key)!.push(s);
      }
      for (const [key, arr] of wdMap) {
        arr.sort((a, b) => a.date.localeCompare(b.date));
        map.set(key, arr);
      }
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [sessions, schedule]);

  const allDates = useMemo(() => {
    const dates = sessions.map(s => s.date).filter(Boolean).sort();
    return { min: dates[0] || '', max: dates[dates.length - 1] || '' };
  }, [sessions]);

  const filteredGroups = useMemo(() => {
    const entries = Array.from(studentGroups.entries())
      .sort(([a], [b]) => {
        const aUnmatched = a.includes('(unzugeordnet)');
        const bUnmatched = b.includes('(unzugeordnet)');
        if (aUnmatched !== bUnmatched) return aUnmatched ? 1 : -1;
        return a.localeCompare(b);
      });

    return entries.filter(([name, sessions]) => {
      if (studentFilter && !name.toLowerCase().includes(studentFilter.toLowerCase())) return false;
      if (dateFrom || dateTo) {
        return sessions.some(s => {
          if (dateFrom && s.date < dateFrom) return false;
          if (dateTo && s.date > dateTo) return false;
          return true;
        });
      }
      return true;
    });
  }, [studentGroups, studentFilter, dateFrom, dateTo]);

  function getStudentDateRange(studentSessions: AlsFileStats[]): { min: string; max: string } {
    const dates = studentSessions.map(s => s.date).filter(Boolean).sort();
    return { min: dates[0] || '', max: dates[dates.length - 1] || '' };
  }

  const handleSave = useCallback(async () => {
    onScheduleChange(editSchedule);
    setEditing(false);
    try {
      await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: editSchedule }),
      });
    } catch {
      // Backend not reachable -> localStorage handled by parent
    }
  }, [editSchedule, onScheduleChange]);

  const addSlot = () => {
    setEditSchedule(prev => [...prev, { weekday: 1, time: '14:00', studentName: '', duration: 30 }]);
  };

  const removeSlot = (idx: number) => {
    setEditSchedule(prev => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, field: keyof ScheduleEntry, value: string | number) => {
    setEditSchedule(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const entries: ScheduleEntry[] = [];
      for (const e of parsed.entries ?? parsed) {
        if (!e.date || !e.start || !e.students?.length) continue;
        const dt = new Date(e.date);
        const wd = dt.getDay();
        const timeStr = e.start.includes('T') ? e.start.split('T')[1].slice(0, 5) :
                        e.start.includes(' ') ? e.start.split(' ')[1].slice(0, 5) :
                        e.start.slice(0, 5);
        const endStr = e.end?.includes('T') ? e.end.split('T')[1].slice(0, 5) :
                       e.end?.includes(' ') ? e.end.split(' ')[1].slice(0, 5) :
                       e.end?.slice(0, 5) || '';
        const [sh, sm] = timeStr.split(':').map(Number);
        const [eh, em] = endStr ? endStr.split(':').map(Number) : [sh + 0, sm + 30];
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        entries.push({
          weekday: wd,
          time: timeStr,
          studentName: e.students[0],
          duration: dur > 0 ? dur : 30,
        });
      }
      const map = new Map<string, ScheduleEntry>();
      for (const e of entries) {
        map.set(`${e.weekday}|${e.time}`, e);
      }
      let merged = Array.from(map.values()).sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
      merged = anonymizeNames(merged);
      setEditSchedule(merged);
      setShowImport(false);
      setImportText('');
    } catch (err) {
      alert('Import fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(schedule, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stundenplan.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleCollapse = (name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsed(new Set(filteredGroups.map(([name]) => name)));
  };

  const expandAll = () => {
    setCollapsed(new Set());
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <User className="w-4 h-4" />
          Schüler-Fortschritt (nach Stundenplan)
        </h3>
        <div className="flex items-center gap-2">
          <button
            disabled
            title="Import deaktiviert"
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-900/30 text-emerald-700 border border-emerald-800/30 opacity-50 cursor-not-allowed"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Axinio live
          </button>
          <button
            disabled
            title="Import deaktiviert"
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-900/30 text-indigo-700 border border-indigo-800/30 opacity-50 cursor-not-allowed"
          >
            <Upload className="w-3.5 h-3.5" />
            Importieren
          </button>
          <button
            onClick={handleExport}
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-slate-700 border border-slate-600 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button
            onClick={() => editing ? handleSave() : setEditing(true)}
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-slate-700 border border-slate-600 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            {editing ? <Save className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
            {editing ? 'Speichern' : 'Stundenplan bearbeiten'}
          </button>
        </div>
      </div>

      <MetricExplanationHelp open={showHelp} onToggle={() => setShowHelp(!showHelp)} />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-800/40 border border-slate-700/50 rounded-lg p-2">
        <div className="flex items-center gap-1 flex-1 min-w-[140px]">
          <Search className="w-3 h-3 text-slate-500" />
          <input
            type="text"
            value={studentFilter}
            onChange={e => setStudentFilter(e.target.value)}
            placeholder="Schüler filtern..."
            className="bg-transparent text-xs text-slate-200 placeholder-slate-600 border-none outline-none w-full"
          />
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3 text-slate-500" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            min={allDates.min}
            max={allDates.max}
            className="bg-slate-900 text-[10px] text-slate-300 border border-slate-700 rounded px-1.5 py-1 w-28"
            placeholder="Von"
          />
          <span className="text-[10px] text-slate-600">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            min={allDates.min}
            max={allDates.max}
            className="bg-slate-900 text-[10px] text-slate-300 border border-slate-700 rounded px-1.5 py-1 w-28"
            placeholder="Bis"
          />
        </div>
        {(studentFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setStudentFilter(''); setDateFrom(''); setDateTo(''); }}
            className="text-[10px] text-red-400 hover:text-red-300 px-1"
          >
            zurücksetzen
          </button>
        )}
        {filteredGroups.length > 1 && (
          <div className="flex gap-1 ml-auto">
            <button onClick={collapseAll} className="text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-1 rounded border border-slate-700/50">
              alle einklappen
            </button>
            <button onClick={expandAll} className="text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-1 rounded border border-slate-700/50">
              alle ausklappen
            </button>
          </div>
        )}
      </div>

      {showImport && false && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-400 mb-1">
            Axinio-Kalender-Export (JSON) einfügen
          </div>
          <p className="text-[10px] text-slate-500">
            Exportiere den Kalender aus Axinio als JSON und füge ihn hier ein.
            Die Schüler-Namen werden automatisch anonymisiert (Schüler 1, Schüler 2, …).
          </p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={6}
            className="w-full border border-slate-600 rounded px-2 py-1 bg-slate-900 text-slate-200 text-xs font-mono"
            placeholder='[{"date":"2025-01-15","start":"14:00","end":"14:30","students":["Max Mustermann"]}, ...]'
          />
          <div className="flex gap-2">
            <button
              disabled
              className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white opacity-40 cursor-not-allowed"
            >
              Importieren & anonymisieren
            </button>
            <button
              onClick={() => { setShowImport(false); setImportText(''); }}
              className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-400 mb-2">Stundenplan</div>
          {editSchedule.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <select
                value={entry.weekday}
                onChange={e => updateSlot(i, 'weekday', parseInt(e.target.value))}
                className="border border-slate-600 rounded px-2 py-1 bg-slate-900 text-slate-200"
              >
                {WEEKDAYS.map((d, di) => <option key={di} value={di}>{d}</option>)}
              </select>
              <input
                type="time"
                value={entry.time}
                onChange={e => updateSlot(i, 'time', e.target.value)}
                className="border border-slate-600 rounded px-2 py-1 bg-slate-900 text-slate-200 w-24"
              />
              <input
                type="text"
                value={entry.studentName}
                onChange={e => updateSlot(i, 'studentName', e.target.value)}
                placeholder="Schüler Name"
                className="border border-slate-600 rounded px-2 py-1 bg-slate-900 text-slate-200 flex-1"
              />
              <select
                value={entry.duration}
                onChange={e => updateSlot(i, 'duration', parseInt(e.target.value))}
                className="border border-slate-600 rounded px-2 py-1 bg-slate-900 text-slate-200"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
              </select>
              <button
                onClick={() => removeSlot(i)}
                className="text-red-500 hover:text-red-700 px-1"
              >✕</button>
            </div>
          ))}
          <button
            onClick={addSlot}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1"
          >+ Slot hinzufügen</button>
        </div>
      )}

      {filteredGroups.length === 0 && !editing && (
        <div className="text-xs text-slate-400 italic p-4 text-center">
          {studentFilter || dateFrom || dateTo
            ? 'Keine Schüler gefunden, die den Filtern entsprechen.'
            : 'Keine Schüler gefunden. Erstelle einen Stundenplan, um Sessions zuzuordnen.'}
        </div>
      )}

      {filteredGroups.map(([name, studentSessions]) => {
        const isCollapsed = collapsed.has(name);
        const range = getStudentDateRange(studentSessions);
        return (
          <div key={name} className="bg-slate-900/60 border border-slate-700/50 rounded-lg">
            <button
              onClick={() => toggleCollapse(name)}
              className="w-full flex items-center justify-between p-3 text-sm font-bold text-slate-100 hover:bg-slate-800/40 transition-colors rounded-lg"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                <span>{name}</span>
                <span className="text-[10px] font-normal text-slate-500">{studentSessions.length} Sessions</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-slate-500 font-normal">
                <span>{range.min} – {range.max}</span>
                <span>
                  Drift Ø {(studentSessions.reduce((a, s) => a + s.avgDriftMs, 0) / studentSessions.length).toFixed(1)}ms
                </span>
              </div>
            </button>
            {!isCollapsed && (
              <div className="px-3 pb-3">
                <StudentCharts sessions={studentSessions} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
