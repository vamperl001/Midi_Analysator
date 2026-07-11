import { useRef, useEffect, useMemo } from 'react';
import { select, scaleLinear, scaleBand, axisBottom, axisLeft, area, line, curveBasis } from 'd3';
import { AlsFileStats, MidiNote } from '../types';

interface Props {
  sessions: AlsFileStats[];
  selectedNoteKey: number | null;
  onSelectNoteKey: (key: number | null) => void;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function getNoteName(key: number): string {
  return `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
}

const BIN_COUNT = 40;
const MS_RANGE = 50;

export default function D3DriftHistogram({ sessions, selectedNoteKey, onSelectNoteKey }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const allNotes = useMemo(() => {
    return sessions.flatMap(s => s.notes.map(n => ({ ...n, sessionDate: s.date })));
  }, [sessions]);

  const filteredNotes = useMemo(() => {
    if (selectedNoteKey === null) return allNotes;
    return allNotes.filter(n => n.key === selectedNoteKey);
  }, [allNotes, selectedNoteKey]);

  const { bins, stats, kdePoints } = useMemo(() => {
    if (filteredNotes.length === 0) return { bins: [], stats: null, kdePoints: null };

    const offsets = filteredNotes.map(n => n.gridOffsetMs);
    const sorted = [...offsets].sort((a, b) => a - b);
    const n = sorted.length;

    const mean = offsets.reduce((s, v) => s + v, 0) / n;
    const variance = offsets.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const median = sorted[Math.floor(n / 2)];
    const skewness = std > 0 ? offsets.reduce((s, v) => s + (v - mean) ** 3, 0) / n / std ** 3 : 0;

    const early = offsets.filter(o => o < -1.5).length;
    const late = offsets.filter(o => o > 1.5).length;

    // Separate bass/treble
    const bass = filteredNotes.filter(n => n.key < 60).map(n => n.gridOffsetMs);
    const treble = filteredNotes.filter(n => n.key >= 60).map(n => n.gridOffsetMs);

    // Binning
    const binWidth = (MS_RANGE * 2) / BIN_COUNT;
    const binStart = -MS_RANGE;
    const histBins = Array.from({ length: BIN_COUNT }, (_, i) => ({
      lower: binStart + i * binWidth,
      upper: binStart + (i + 1) * binWidth,
      all: 0, bass: 0, treble: 0,
    }));

    const assignToBins = (arr: number[], field: 'all' | 'bass' | 'treble') => {
      for (const v of arr) {
        const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((v - binStart) / binWidth)));
        histBins[idx][field]++;
      }
    };
    assignToBins(offsets, 'all');
    assignToBins(bass, 'bass');
    assignToBins(treble, 'treble');

    // KDE (simple gaussian kernel) - cap data size to avoid stack issues
    const MAX_KDE_SAMPLES = 5000;
    const sampledData = offsets.length > MAX_KDE_SAMPLES
      ? offsets.filter(() => Math.random() < MAX_KDE_SAMPLES / offsets.length)
      : offsets;
    const sampledBass = bass.length > MAX_KDE_SAMPLES
      ? bass.filter(() => Math.random() < MAX_KDE_SAMPLES / bass.length)
      : bass;
    const sampledTreble = treble.length > MAX_KDE_SAMPLES
      ? treble.filter(() => Math.random() < MAX_KDE_SAMPLES / treble.length)
      : treble;

    const kde = (data: number[], points: number): { x: number; y: number }[] => {
      if (data.length < 2) return [];
      const bw = 1.06 * std * n ** -0.2;
      let dMin = data[0], dMax = data[0];
      for (const v of data) {
        if (v < dMin) dMin = v;
        if (v > dMax) dMax = v;
      }
      const min = Math.max(-MS_RANGE, dMin - bw * 3);
      const max = Math.min(MS_RANGE, dMax + bw * 3);
      const step = (max - min) / points;
      const result: { x: number; y: number }[] = [];
      for (let i = 0; i < points; i++) {
        const x = min + i * step;
        let sum = 0;
        for (let j = 0; j < data.length; j++) {
          sum += Math.exp(-((x - data[j]) ** 2) / (2 * bw ** 2));
        }
        result.push({ x, y: sum / (bw * Math.sqrt(2 * Math.PI) * n) });
      }
      return result;
    };

    const allKde = kde(sampledData, 80);
    const bassKde = kde(sampledBass, 80);
    const trebleKde = kde(sampledTreble, 80);

    return {
      bins: histBins,
      stats: { avg: mean, std, median, skewness, earlyPct: Math.round(early / n * 100), latePct: Math.round(late / n * 100), total: n, bassPct: Math.round(bass.length / n * 100) },
      kdePoints: { all: allKde, bass: bassKde, treble: trebleKde },
    };
  }, [filteredNotes]);

  useEffect(() => {
    if (!svgRef.current || !bins.length) return;
    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth ?? 600;
    const height = 260;
    const margin = { top: 12, right: 12, bottom: 28, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    svg.attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = scaleLinear().domain([-MS_RANGE, MS_RANGE]).range([0, innerW]);
    const maxCount = Math.max(...bins.map(b => b.all), 1);
    const yScale = scaleLinear().domain([0, maxCount * 1.1]).range([innerH, 0]);

    // Grid lines
    g.append('g').attr('class', 'grid')
      .call(axisLeft(yScale).ticks(5).tickSize(-innerW).tickFormat(() => '') as any)
      .selectAll('line').attr('stroke', 'rgb(51 65 85)').attr('stroke-dasharray', '2,2');

    // Y axis
    g.append('g').call(axisLeft(yScale).ticks(5).tickSize(0) as any)
      .attr('color', 'rgb(100 116 139)').style('font-size', '9px').style('font-family', 'monospace');

    // Zero line
    g.append('line')
      .attr('x1', xScale(0)).attr('x2', xScale(0))
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', 'rgb(148 163 184)').attr('stroke-dasharray', '4,2').attr('stroke-width', 1);

    // Zero label
    g.append('text').attr('x', xScale(0) + 3).attr('y', 10)
      .attr('fill', 'rgb(148 163 184)').style('font-size', '8px').style('font-family', 'monospace')
      .text('Grid (0ms)');

    // Bars: treble (behind)
    const barW = innerW / bins.length - 1;
    g.selectAll('.bar-treble').data(bins as any).join('rect')
      .attr('class', 'bar-treble')
      .attr('x', (_: any, i: number) => xScale(_.lower + (_.upper - _.lower) / 2) - barW / 2)
      .attr('y', (_: any) => yScale(_.treble))
      .attr('width', barW)
      .attr('height', (_: any) => innerH - yScale(_.treble))
      .attr('fill', '#818cf8').attr('opacity', 0.4);

    // Bars: bass (front)
    g.selectAll('.bar-bass').data(bins as any).join('rect')
      .attr('class', 'bar-bass')
      .attr('x', (_: any, i: number) => xScale(_.lower + (_.upper - _.lower) / 2) - barW / 2)
      .attr('y', (_: any) => yScale(_.bass))
      .attr('width', barW)
      .attr('height', (_: any) => innerH - yScale(_.bass))
      .attr('fill', '#f59e0b').attr('opacity', 0.6);

    // KDE areas
    if (kdePoints?.all.length) {
      const kdeScale = scaleLinear().domain([0, Math.max(...kdePoints.all.map(d => d.y), 0.01) * 1.2]).range([innerH, 0]);
      const kdeArea = area<{ x: number; y: number }>()
        .x(d => xScale(d.x)).y0(innerH).y1(d => kdeScale(d.y)).curve(curveBasis);
      g.append('path').datum(kdePoints.all).attr('d', kdeArea).attr('fill', '#6366f1').attr('opacity', 0.15);

      const kdeLine = line<{ x: number; y: number }>()
        .x(d => xScale(d.x)).y(d => kdeScale(d.y)).curve(curveBasis);
      g.append('path').datum(kdePoints.all).attr('d', kdeLine)
        .attr('fill', 'none').attr('stroke', '#a5b4fc').attr('stroke-width', 1.5).attr('opacity', 0.8);

      if (kdePoints.bass.length) {
        g.append('path').datum(kdePoints.bass).attr('d', kdeLine)
          .attr('fill', 'none').attr('stroke', '#f59e0b').attr('stroke-width', 1.5).attr('opacity', 0.6);
      }
      if (kdePoints.treble.length) {
        g.append('path').datum(kdePoints.treble).attr('d', kdeLine)
          .attr('fill', 'none').attr('stroke', '#818cf8').attr('stroke-width', 1.5).attr('opacity', 0.6);
      }
    }

    // X axis
    g.append('g').attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(xScale).ticks(8).tickFormat(d => `${d}ms`) as any)
      .attr('color', 'rgb(100 116 139)').style('font-size', '9px').style('font-family', 'monospace');

    // Interactive hover
    const tooltip = svg.append('g').attr('class', 'tooltip').style('display', 'none');
    const tooltipRect = tooltip.append('rect').attr('fill', 'rgb(15 23 42)').attr('rx', 4).attr('ry', 4)
      .attr('stroke', 'rgb(71 85 105)').attr('stroke-width', 1);
    const tooltipText = tooltip.append('text').attr('fill', 'rgb(226 232 240)')
      .style('font-size', '9px').style('font-family', 'monospace').attr('x', 8).attr('y', 16);

    const hoverBar = g.append('rect').attr('fill', 'transparent')
      .attr('width', innerW).attr('height', innerH)
      .style('cursor', 'crosshair');

    hoverBar.on('mousemove', (event: any) => {
      const mx = select(event.currentTarget).node() as SVGRectElement;
      const rect = mx.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const ms = xScale.invert(x);
      const bin = bins[Math.min(bins.length - 1, Math.max(0, Math.floor((ms + MS_RANGE) / ((MS_RANGE * 2) / bins.length))))];
      tooltip.style('display', null);
      const ttX = Math.min(x + margin.left + 10, width - 160);
      const ttY = 10;
      tooltip.attr('transform', `translate(${ttX},${ttY})`);
      tooltipText.text(`${bin.lower.toFixed(0)} bis ${bin.upper.toFixed(0)}ms · ${bin.all} Noten (Bass ${bin.bass} · Diskant ${bin.treble})`);
      const bbox = (tooltipText.node() as SVGTextElement)?.getBBox();
      if (bbox) tooltipRect.attr('width', bbox.width + 16).attr('height', bbox.height + 12).attr('y', bbox.y - 6).attr('x', bbox.x - 4);
    }).on('mouseleave', () => tooltip.style('display', 'none'));
  }, [bins, kdePoints]);

  return (
    <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col" id="chart-drift-histogram">
      <div className="mb-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold tracking-widest text-slate-100 uppercase font-mono">
            ★ Microtiming-Drift-Verteilung
          </h3>
          {selectedNoteKey !== null && (
            <button onClick={() => onSelectNoteKey(null)}
              className="text-xs text-blue-400 hover:text-blue-300 font-mono cursor-pointer">
              Clear Filter ({getNoteName(selectedNoteKey)})
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1 italic font-serif">
          {selectedNoteKey === null
            ? 'Wahre Abweichung aller MIDI-Noten von der quantisierten Grid-Sollzeit.'
            : `Spezifischer Drift für Note ${getNoteName(selectedNoteKey)}.`}
        </p>
      </div>

      <div ref={containerRef} className="relative flex-1 min-h-[260px] bg-slate-800/40 p-4 rounded border border-slate-700/50 flex flex-col justify-end">
        <svg ref={svgRef} className="w-full" />
      </div>

      <div className="flex gap-4 mt-2 text-[9px] font-mono text-slate-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 opacity-60" /> Bass (&lt;C4)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-400 opacity-50" /> Diskant (&ge;C4)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-300 opacity-80" /> KDE (Gesamt)</span>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-2 mt-4 text-center font-mono">
          {[
            { label: 'MEDIAN', value: `${stats.median > 0 ? '+' : ''}${stats.median.toFixed(1)} ms`, color: Math.abs(stats.median) < 4 ? '' : 'text-blue-400' },
            { label: 'JITTER (STD)', value: `${stats.std.toFixed(1)} ms` },
            { label: 'SCHIEFE', value: `${stats.skewness > 0 ? '+' : ''}${stats.skewness.toFixed(2)}`, color: Math.abs(stats.skewness) > 0.3 ? 'text-amber-400' : '' },
            { label: 'EARLY/LATE', value: `-${stats.earlyPct}% | +${stats.latePct}%`, sub: `Bass ${stats.bassPct}%` },
          ].map(s => (
            <div key={s.label} className="bg-slate-800/40 p-2.5 rounded border border-slate-700/50">
              <div className="text-[9px] text-slate-400 uppercase tracking-wider">{s.label}</div>
              <div className={`text-xs font-bold ${s.color || 'text-slate-100'}`}>{s.value}</div>
              {s.sub && <div className="text-[8px] text-slate-500">{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className="mt-4 text-xs text-slate-400 leading-snug bg-slate-800/40 p-3 rounded border border-slate-700/50 font-mono">
          {Math.abs(stats.avg) < 3 && stats.std < 12
            ? <span className="text-emerald-400">✔ Äußerst tightes Timing! Minimale Abweichung, maschinell präzise eingespielt.</span>
            : stats.median > 6
              ? <span className="text-slate-300">⚡ Timing-Tendenzen laid-back (behind the beat).</span>
              : stats.median < -6
                ? <span className="text-slate-300">⚡ Timing treibend (ahead of the beat).</span>
                : <span className="text-slate-300">Natürlicher rhythmischer Rhythmus mit organischen Schwankungen.</span>
          }
        </div>
      )}
    </div>
  );
}
