import React, { useState, useMemo, useCallback } from 'react';
import { AlsFileStats, ScheduleEntry } from '../types';
import { User, Edit3, Save, Upload, Download, RefreshCw, TrendingUp, Activity } from 'lucide-react';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function matchStudent(session: AlsFileStats, schedule: ScheduleEntry[]): string | null {
  if (!schedule.length) return null;
  const sessionStart = parseTime(session.time);
  // First try exact match (within slot boundaries +5min tolerance)
  for (const entry of schedule) {
    if (entry.weekday !== session.weekday) continue;
    const slotStart = parseTime(entry.time);
    const slotEnd = slotStart + entry.duration + 5;
    if (sessionStart >= slotStart - 5 && sessionStart <= slotEnd) {
      return entry.studentName;
    }
  }
  // Fallback: find nearest slot on the same weekday within 4 hours
  let bestDist = 4 * 60;
  let bestName: string | null = null;
  for (const entry of schedule) {
    if (entry.weekday !== session.weekday) continue;
    const slotStart = parseTime(entry.time);
    const dist = Math.abs(sessionStart - slotStart);
    if (dist < bestDist) {
      bestDist = dist;
      bestName = entry.studentName;
    }
  }
  return bestName;
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

  return (
    <>
      <div className="grid grid-cols-4 gap-3 mb-4 text-center font-mono">
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
          <div className="text-[8px] text-slate-400 uppercase font-black">Sessions</div>
          <div className="text-sm font-bold text-white">{n}</div>
        </div>
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
          <div className="text-[8px] text-slate-400 uppercase font-black">ø Drift</div>
          <div className="text-sm font-bold text-amber-400">{avgDrift.toFixed(1)}ms</div>
        </div>
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
          <div className="text-[8px] text-slate-400 uppercase font-black">Trend</div>
          <div className={`text-sm font-bold ${Number(driftChange) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {Number(driftChange) > 0 ? '↓' : '↑'} {Math.abs(Number(driftChange))}%
          </div>
        </div>
        <div className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
          <div className="text-[8px] text-slate-400 uppercase font-black">ø BPM</div>
          <div className="text-sm font-bold text-white">{avgBpm.toFixed(0)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div>
          <div className="text-xs font-semibold text-slate-400 mb-1">Drift-Entwicklung</div>
          <div className="h-24 flex items-end gap-1">
            {sorted.map((s, i) => {
              const maxDrift = Math.max(...sorted.map(x => x.avgDriftMs), 1);
              const h = (s.avgDriftMs / maxDrift) * 100;
              const color = s.avgDriftMs < 12 ? 'bg-emerald-500' : s.avgDriftMs < 20 ? 'bg-amber-500' : 'bg-red-500';
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${s.date}: ${s.avgDriftMs.toFixed(1)}ms`}>
                  <div className={`w-full ${color} rounded-t`} style={{ height: `${h}%`, minHeight: 2 }} />
                  <span className="text-[8px] text-slate-500 rotate-45 origin-left whitespace-nowrap">{s.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-400 mb-1">Drift (ms) &Oslash;</div>
          <div className="h-24 flex items-end gap-1">
            {sessions.map((s, i) => {
              const maxDrift = Math.max(...sessions.map(x => x.avgDriftMs), 1);
              const h = (s.avgDriftMs / maxDrift) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full bg-amber-500 rounded-t" style={{ height: `${h}%`, minHeight: 2 }} />
                  <span className="text-[9px] text-slate-500 rotate-45 origin-left whitespace-nowrap">{s.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-400 mb-1">BPM</div>
          <div className="h-24 flex items-end gap-1">
            {sessions.map((s, i) => {
              const bpm = s.estimatedBpm ?? s.tempo;
              const minBpm = Math.min(...sessions.map(x => x.estimatedBpm ?? x.tempo));
              const maxBpm = Math.max(...sessions.map(x => x.estimatedBpm ?? x.tempo));
              const range = Math.max(maxBpm - minBpm, 5);
              const h = (bpm - minBpm) / range * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full bg-emerald-500 rounded-t" style={{ height: `${h}%`, minHeight: 2 }} />
                  <span className="text-[9px] text-slate-500 rotate-45 origin-left whitespace-nowrap">{s.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-400 mb-1">Velocity &Oslash;</div>
          <div className="h-24 flex items-end gap-1">
            {sessions.map((s, i) => {
              const minVel = Math.min(...sessions.map(x => x.avgVelocity));
              const maxVel = Math.max(...sessions.map(x => x.avgVelocity));
              const range = Math.max(maxVel - minVel, 10);
              const h = (s.avgVelocity - minVel) / range * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full bg-purple-500 rounded-t" style={{ height: `${h}%`, minHeight: 2 }} />
                  <span className="text-[9px] text-slate-500 rotate-45 origin-left whitespace-nowrap">{s.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-400 mb-1">Focus Score</div>
          <div className="h-24 flex items-end gap-1">
            {sessions.map((s, i) => {
              const minScore = Math.min(...sessions.map(x => x.focusScore ?? 0));
              const maxScore = Math.max(...sessions.map(x => x.focusScore ?? 0));
              const range = Math.max(maxScore - minScore, 10);
              const h = ((s.focusScore ?? 0) - minScore) / range * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full bg-rose-500 rounded-t" style={{ height: `${h}%`, minHeight: 2 }} />
                  <span className="text-[9px] text-slate-500 rotate-45 origin-left whitespace-nowrap">{s.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {withSplit.length > 0 && (
        <div className="text-[10px] text-slate-300 bg-amber-900/20 border border-amber-800/30 rounded p-2 flex flex-wrap gap-3">
          <span className="font-semibold">Lehrer/Sch&uuml;ler:</span>
          <span>Lehrer-Drift &Oslash; {teacherDrift.toFixed(1)} ms</span>
          <span>Sch&uuml;ler-Drift &Oslash; {studentDrift.toFixed(1)} ms</span>
          <span>Sch&uuml;ler-Anteil &Oslash; {studentPct.toFixed(0)}%</span>
        </div>
      )}

      <div className="text-xs text-slate-400 grid grid-cols-5 gap-2 pt-2 border-t border-slate-700/50">
        <div>{n} Sessions</div>
        <div>BPM &Oslash; {avgBpm.toFixed(1)}</div>
        <div>Drift &Oslash; {avgDrift.toFixed(1)} ms</div>
        <div>Velocity &Oslash; {avgVel}</div>
        <div>Focus &Oslash; {avgFocus}</div>
      </div>
    </>
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

  const studentGroups = useMemo(() => {
    const map = new Map<string, AlsFileStats[]>();
    const unmatched: AlsFileStats[] = [];
    for (const s of sessions) {
      const name = matchStudent(s, schedule);
      if (name) {
        if (!map.has(name)) map.set(name, []);
        // Zeit aus dem passenden Slot übernehmen
        const match = schedule.find(e => e.studentName === name);
        map.get(name)!.push(match && match.time !== s.time ? { ...s, time: match.time } : s);
      } else {
        unmatched.push(s);
      }
    }
    // Unzugeordnete Sessions nach Wochentag gruppieren
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
      // Deduplicate (last wins for same weekday+time)
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <User className="w-4 h-4" />
          Schüler-Fortschritt (nach Stundenplan)
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const res = await fetch('/api/axinio/timetable');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.entries?.length) throw new Error('Keine Termine gefunden');
                const entries: ScheduleEntry[] = [];
                for (const e of data.entries) {
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
                onScheduleChange(merged);
                try {
                  await fetch('/api/schedule', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ schedule: merged }),
                  });
                } catch {}
                alert(`${merged.length} Zeit-Slots aus Axinio importiert und anonymisiert.`);
              } catch (err) {
                alert('Axinio-Import fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)));
              }
            }}
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-800/50 hover:bg-emerald-900/50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Axinio live
          </button>
          <button
            onClick={() => { setShowImport(!showImport); setImportText(''); }}
            className="text-xs flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/50 hover:bg-indigo-900/50 transition-colors"
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

      {showImport && (
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
              onClick={handleImport}
              disabled={!importText.trim()}
              className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
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

      {studentGroups.size === 0 && !editing && (
        <div className="text-xs text-slate-400 italic p-4 text-center">
          Keine Schüler gefunden. Erstelle einen Stundenplan, um Sessions zuzuordnen.
        </div>
      )}

      {Array.from(studentGroups.entries())
        .sort(([a], [b]) => {
          const aUnmatched = a.includes('(unzugeordnet)');
          const bUnmatched = b.includes('(unzugeordnet)');
          if (aUnmatched !== bUnmatched) return aUnmatched ? 1 : -1;
          return a.localeCompare(b);
        })
        .map(([name, studentSessions]) => (
        <div key={name} className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-4 space-y-3">
          <div className="text-sm font-bold text-slate-100">{name}</div>
          <StudentCharts sessions={studentSessions} />
        </div>
      ))}
    </div>
  );
}
