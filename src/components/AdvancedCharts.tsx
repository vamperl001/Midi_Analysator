import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, LineChart, Line, Area, AreaChart, Cell,
  Legend, ReferenceLine
} from 'recharts';
import { AlsFileStats } from '../types';
import { chart as chartTheme, accent } from '../theme';
import {
  Music, TrendingUp, Activity, Heart, Calendar, Layers,
  ChevronDown, ChevronUp, BarChart3, LineChart as LineChartIcon
} from 'lucide-react';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function getNoteName(key: number): string {
  return `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
}

const SECTION_STYLES = "bg-slate-900/80 border border-slate-700/50 rounded-lg p-6";

interface AdvancedChartsProps {
  data: AlsFileStats[];
}

export const AdvancedCharts: React.FC<AdvancedChartsProps> = ({ data }) => {
  const allNotes = useMemo(() => data.flatMap(s => s.notes), [data]);

  // Calculate weekdays from session dates
  const weekdayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const weekdayData = useMemo(() => {
    const buckets: Record<number, { count: number; totalDrift: number; totalVel: number }> = {};
    data.forEach(s => {
      const day = new Date(s.date).getDay();
      if (!buckets[day]) buckets[day] = { count: 0, totalDrift: 0, totalVel: 0 };
      buckets[day].count++;
      buckets[day].totalDrift += s.avgDriftMs;
      buckets[day].totalVel += s.avgVelocity;
    });
    return Array.from({ length: 7 }, (_, i) => ({
      day: weekdayNames[i],
      count: buckets[i]?.count || 0,
      avgDrift: buckets[i] ? buckets[i].totalDrift / buckets[i].count : 0,
      avgVelocity: buckets[i] ? Math.round(buckets[i].totalVel / buckets[i].count) : 0,
    }));
  }, [data]);

  // Velocity distribution
  const velocityHistogram = useMemo(() => {
    const bins = Array.from({ length: 13 }, (_, i) => ({
      range: `${i * 10}-${(i + 1) * 10}`,
      min: i * 10,
      count: 0,
    }));
    allNotes.forEach(n => {
      const idx = Math.min(Math.floor(n.velocity / 10), 12);
      bins[idx].count++;
    });
    return bins;
  }, [allNotes]);

  // Key/density heatmap
  const noteDensity = useMemo(() => {
    const keyCount: Record<number, number> = {};
    allNotes.forEach(n => {
      keyCount[n.key] = (keyCount[n.key] || 0) + 1;
    });
    const keys = Object.keys(keyCount).map(Number).sort((a, b) => a - b);
    const maxCount = Math.max(...Object.values(keyCount), 1);
    return keys.map(k => ({
      key: k,
      noteName: getNoteName(k),
      count: keyCount[k],
      intensity: keyCount[k] / maxCount,
    }));
  }, [allNotes]);

  // Polyphony vs Drift scatter data
  const polyDriftData = useMemo(() => {
    return data.filter(s => s.polyphony).map(s => ({
      date: s.date,
      polyphony: s.polyphony!.avgPolyphony,
      drift: s.avgDriftMs,
      fileName: s.fileName,
      tempo: s.tempo,
    }));
  }, [data]);

  // Pedal accuracy over time
  const pedalData = useMemo(() => {
    return data
      .filter(s => s.pedalAnalysis)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({
        date: s.date,
        accuracy: s.pedalAnalysis!.accuracyScore,
        classification: s.pedalAnalysis!.errorClassification,
        avgDelay: s.pedalAnalysis!.avgDelayMs,
        avgDrift: s.avgDriftMs,
      }));
  }, [data]);

  // BPM stability (sliding tempo within session - show first session with data)
  const [selectedBpmSession, setSelectedBpmSession] = useState<number>(0);
  const bpmSessionOptions = useMemo(() => {
    return data.filter(s => s.slidingTempo && s.slidingTempo.length > 2);
  }, [data]);

  const bpmChartData = useMemo(() => {
    const session = bpmSessionOptions[selectedBpmSession];
    if (!session?.slidingTempo) return [];
    return session.slidingTempo.map(p => ({
      time: p.timeSec.toFixed(1),
      bpm: p.bpm,
    }));
  }, [bpmSessionOptions, selectedBpmSession]);

  // Sections open/close state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    velocity: true,
    piano: true,
    bpm: true,
    poly: true,
    pedal: true,
    weekday: true,
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (data.length === 0) return null;

  const SectionHeader = ({ id, icon, title, color }: { id: string; icon: React.ReactNode; title: string; color: string }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between text-xs font-bold tracking-widest text-slate-100 uppercase font-mono mb-4 cursor-pointer hover:text-slate-300 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        {title}
      </div>
      {openSections[id] ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Velocity Distribution */}
      <div className={SECTION_STYLES}>
        <SectionHeader id="velocity" icon={<BarChart3 className="w-4 h-4" />} title="Velocity-Verteilung (Anschlagsstärke)" color="text-orange-600" />
        {openSections.velocity && (
          <div>
            <p className="text-xs text-slate-400 italic font-serif mb-4">
              Wie gleichmäßig schlägst du die Tasten an? Eine breite Verteilung zeigt dynamisches, ausdrucksstarkes Spiel.
            </p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={velocityHistogram}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.axis} />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} stroke={chartTheme.axisText} />
                <YAxis tick={{ fontSize: 10 }} stroke={chartTheme.axisText} />
                <Tooltip
                  contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                  formatter={(value: number) => [value.toLocaleString(), 'Anzahl']}
                  labelFormatter={(label) => `Velocity ${label}`}
                />
                <Bar dataKey="count" fill={accent.orange} radius={[2, 2, 0, 0]}>
                  {velocityHistogram.map((entry, idx) => (
                    <Cell key={idx} fill={entry.count > 0 ? '#f97316' : '#f1f5f9'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-3 gap-4 mt-4 text-xs font-mono">
              <div className="bg-slate-800/40 rounded p-3 text-center">
                <span className="text-slate-500 text-[10px] uppercase block">Ø Velocity</span>
                <span className="text-lg font-bold text-slate-100">
                  {Math.round(allNotes.reduce((s, n) => s + n.velocity, 0) / (allNotes.length || 1))}
                </span>
              </div>
              <div className="bg-slate-800/40 rounded p-3 text-center">
                <span className="text-slate-500 text-[10px] uppercase block">Min</span>
                <span className="text-lg font-bold text-slate-100">{allNotes.length > 0 ? allNotes.reduce((a, n) => Math.min(a, n.velocity), Infinity) : 0}</span>
              </div>
              <div className="bg-slate-800/40 rounded p-3 text-center">
                <span className="text-slate-500 text-[10px] uppercase block">Max</span>
                <span className="text-lg font-bold text-slate-100">{allNotes.length > 0 ? allNotes.reduce((a, n) => Math.max(a, n.velocity), -Infinity) : 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Piano-Roll Heatmap (Note Density) */}
      <div className={SECTION_STYLES}>
        <SectionHeader id="piano" icon={<Music className="w-4 h-4" />} title="Piano-Roll Dichte (Welche Töne spielst du?)" color="text-indigo-600" />
        {openSections.piano && (
          <div>
            <p className="text-xs text-slate-400 italic font-serif mb-4">
              Je dunkler das Feld, desto öfter wurde dieser Ton gespielt. Zeigt deine bevorzugten Lagen undTonvorräte.
            </p>
            <div className="overflow-x-auto">
              <div className="flex gap-0.5 min-w-max" style={{ flexWrap: 'wrap' }}>
                {noteDensity.map((n, idx) => (
                  <div
                    key={idx}
                    className="w-8 h-10 flex items-center justify-center text-[8px] font-mono font-bold rounded-sm transition-colors cursor-pointer hover:ring-1 hover:ring-slate-400"
                    style={{
                      backgroundColor: `rgba(99, 102, 241, ${0.1 + n.intensity * 0.85})`,
                      color: n.intensity > 0.5 ? 'white' : '#475569',
                    }}
                    title={`${n.noteName}: ${n.count} mal`}
                  >
                    {n.noteName}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 text-[10px] font-mono text-slate-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-900/40 inline-block"></span> selten</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-500 inline-block"></span> mittel</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-300 inline-block"></span> häufig</span>
            </div>
          </div>
        )}
      </div>

      {/* BPM Stability */}
      <div className={SECTION_STYLES}>
        <SectionHeader id="bpm" icon={<Activity className="w-4 h-4" />} title="BPM-Stabilität (Sliding Tempo)" color="text-emerald-600" />
        {openSections.bpm && (
          <div>
            <p className="text-xs text-slate-400 italic font-serif mb-4">
              Zeigt, wie stark dein Tempo innerhalb einer Session schwankt – ein ruhiger Verlauf bedeutet sicheres Zeitgefühl.
            </p>
            {bpmSessionOptions.length > 0 ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[10px] font-mono text-slate-400 uppercase">Session:</span>
                  <select
                    value={selectedBpmSession}
                    onChange={e => setSelectedBpmSession(Number(e.target.value))}
                    className="flex-1 bg-slate-900 border border-slate-600 text-slate-200 text-xs px-2 py-1.5 rounded font-mono"
                  >
                    {bpmSessionOptions.map((s, i) => (
                      <option key={i} value={i}>{s.date} – {s.fileName.slice(0, 30)}</option>
                    ))}
                  </select>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={bpmChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.axis} />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke={chartTheme.axisText} label={{ value: 'Sekunden', position: 'bottom', fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} stroke={chartTheme.axisText} domain={['dataMin - 5', 'dataMax + 5']} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                      formatter={(value: number) => [`${value.toFixed(1)} BPM`, 'Tempo']}
                      labelFormatter={(label) => `${label}s`}
                    />
                    <Area type="monotone" dataKey="bpm" stroke={accent.emerald} fill={accent.emerald} fillOpacity={0.15} strokeWidth={2} dot={false} />
                    <ReferenceLine y={bpmChartData[0]?.bpm} stroke={chartTheme.axisText} strokeDasharray="4 4" label={{ value: 'Start-BPM', fontSize: 9, fill: chartTheme.axisText }} />
                  </AreaChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="text-xs text-slate-400 text-center py-8 italic">Keine Sliding-Tempo-Daten verfügbar. Lade Sessions mit Tempo-Analyse.</div>
            )}
          </div>
        )}
      </div>

      {/* Polyphony vs Drift Scatter */}
      <div className={SECTION_STYLES}>
        <SectionHeader id="poly" icon={<Layers className="w-4 h-4" />} title="Polyphonie vs. Drift (Mehr Noten = ungenauer?)" color="text-rose-600" />
        {openSections.poly && (
          <div>
            <p className="text-xs text-slate-400 italic font-serif mb-4">
              Jeder Punkt ist eine Session. Zeigt den Zusammenhang zwischen Gleichzeitigkeit (Akkorddichte) und Timing-Genauigkeit.
            </p>
            {polyDriftData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.axis} />
                  <XAxis
                    dataKey="polyphony"
                    name="Polyphonie"
                    tick={{ fontSize: 10 }} stroke={chartTheme.axisText}
                    label={{ value: 'Ø gleichzeitige Noten', position: 'bottom', fontSize: 10 }}
                  />
                  <YAxis
                    dataKey="drift"
                    name="Drift (ms)"
                    tick={{ fontSize: 10 }} stroke={chartTheme.axisText}
                    label={{ value: 'Drift (ms)', angle: -90, position: 'insideLeft', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                    formatter={(value: number, name: string) => [value.toFixed(2), name === 'polyphony' ? 'Polyphonie' : 'Drift (ms)']}
                    labelFormatter={() => ''}
                  />
                  <Scatter data={polyDriftData} fill={accent.rose} opacity={0.7}>
                    {polyDriftData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.drift > 20 ? '#e11d48' : entry.drift > 10 ? '#f97316' : '#10b981'} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-slate-400 text-center py-8 italic">Keine Polyphonie-Daten verfügbar.</div>
            )}
          </div>
        )}
      </div>

      {/* Pedal Timing Diagram */}
      <div className={SECTION_STYLES}>
        <SectionHeader id="pedal" icon={<Heart className="w-4 h-4" />} title="Pedal-Timing (Sustain-Genauigkeit)" color="text-purple-600" />
        {openSections.pedal && (
          <div>
            <p className="text-xs text-slate-400 italic font-serif mb-4">
              Wie sauber ist deine Pedalarbeit? Höhere Werte = besseres Legato.
            </p>
            {pedalData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={pedalData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.axis} />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke={chartTheme.axisText} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke={chartTheme.axisText} label={{ value: 'Score %', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                      formatter={(value: number) => [`${value}%`, 'Genauigkeit']}
                    />
                    <ReferenceLine y={85} stroke={accent.emerald} strokeDasharray="4 4" label={{ value: 'Hervorragend', fontSize: 9, fill: '#10b981' }} />
                    <ReferenceLine y={60} stroke={accent.orange} strokeDasharray="4 4" label={{ value: 'Kritisch', fontSize: 9, fill: '#f97316' }} />
                    <Line type="monotone" dataKey="accuracy" stroke={accent.violet} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-3 gap-3 mt-4 text-[10px] font-mono">
                  {pedalData.filter(p => p.classification).slice(0, 3).map((p, i) => (
                    <div key={i} className="bg-slate-800/40 rounded p-2 text-center">
                      <span className="text-slate-500 block">{p.date}</span>
                      <span className="font-bold text-slate-100">{p.classification}</span>
                      <span className="text-slate-400 block">{p.avgDelay.toFixed(1)}ms Verzögerung</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-400 text-center py-8 italic">Keine Pedal-Daten verfügbar.</div>
            )}
          </div>
        )}
      </div>

      {/* Weekday Analysis */}
      <div className={SECTION_STYLES}>
        <SectionHeader id="weekday" icon={<Calendar className="w-4 h-4" />} title="Wochentag-Analyse (An welchen Tagen spielst du am besten?)" color="text-sky-600" />
        {openSections.weekday && (
          <div>
            <p className="text-xs text-slate-400 italic font-serif mb-4">
              Durchschnittlicher Drift nach Wochentag. Niedriger = tighter Timing. Erkennst du deine "guten" Tage?
            </p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={weekdayData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.axis} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke={chartTheme.axisText} />
                <YAxis tick={{ fontSize: 10 }} stroke={chartTheme.axisText} label={{ value: 'Ø Drift (ms)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'avgDrift') return [`${value.toFixed(1)} ms`, 'Drift'];
                    if (name === 'count') return [value, 'Sessions'];
                    return [value, name];
                  }}
                />
                <Bar dataKey="avgDrift" radius={[3, 3, 0, 0]}>
                  {weekdayData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.avgDrift > 20 ? '#e11d48' : entry.avgDrift > 10 ? '#f97316' : '#0ea5e9'}
                      fillOpacity={0.5 + entry.count / weekdayData.reduce((a, d) => Math.max(a, d.count), 0) * 0.5}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 mt-3 text-[10px] font-mono">
              {weekdayData.map(d => (
                <div key={d.day} className="bg-slate-800/40 px-2.5 py-1.5 rounded border border-slate-700/50 text-center min-w-[60px]">
                  <div className="text-slate-100 font-bold">{d.day}</div>
                  <div className="text-slate-400">{d.avgDrift.toFixed(1)}ms</div>
                  <div className="text-slate-500 text-[9px]">{d.count} Sessions</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
