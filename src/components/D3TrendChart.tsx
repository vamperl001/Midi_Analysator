import { useRef, useEffect, useMemo } from 'react';
import { select, scaleLinear, scaleTime, axisBottom, axisLeft, line, area, curveBasis } from 'd3';
import { AlsFileStats } from '../types';

interface Props {
  sessions: AlsFileStats[];
}

export default function D3TrendChart({ sessions }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dailyTrend = useMemo(() => {
    const byDate = new Map<string, { drifts: number[]; swings: number[] }>();
    for (const s of sessions) {
      if (!s.date) continue;
      const day = byDate.get(s.date) || { drifts: [], swings: [] };
      day.drifts.push(s.avgDriftMs);
      day.swings.push(s.swingFactor16th);
      byDate.set(s.date, day);
    }

    const sorted = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
    const raw = sorted.map(([date, d]) => ({
      date,
      avgDrift: d.drifts.reduce((s, v) => s + v, 0) / d.drifts.length,
      avgSwing: d.swings.reduce((s, v) => s + v, 0) / d.swings.length,
    }));

    // Rolling average (window 3)
    const window = 3;
    return raw.map((d, i) => {
      const slice = raw.slice(Math.max(0, i - window + 1), i + 1);
      return {
        ...d,
        rollingDrift: slice.reduce((s, v) => s + v.avgDrift, 0) / slice.length,
        rollingSwing: slice.reduce((s, v) => s + v.avgSwing, 0) / slice.length,
      };
    });
  }, [sessions]);

  useEffect(() => {
    if (!svgRef.current || !dailyTrend.length) return;
    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth ?? 600;
    const height = 260;
    const margin = { top: 12, right: 12, bottom: 28, left: 40 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    svg.attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const dates = dailyTrend.map(d => new Date(d.date));
    const xScale = scaleTime().domain([dates[0], dates[dates.length - 1]]).range([0, innerW]);

    const minDrift = Math.min(...dailyTrend.map(d => d.rollingDrift)) * 0.8;
    const maxDrift = Math.max(...dailyTrend.map(d => d.rollingDrift)) * 1.2;
    const driftRange = maxDrift - minDrift || 1;
    const yScale = scaleLinear().domain([minDrift, maxDrift]).range([innerH, 0]);

    // Grid
    g.append('g').attr('class', 'grid')
      .call(axisLeft(yScale).ticks(5).tickSize(-innerW).tickFormat(() => '') as any)
      .selectAll('line').attr('stroke', 'rgb(51 65 85)').attr('stroke-dasharray', '2,2');

    // Y axis
    g.append('g').call(axisLeft(yScale).ticks(5).tickSize(0) as any)
      .attr('color', 'rgb(100 116 139)').style('font-size', '9px').style('font-family', 'monospace');

    type TrendPoint = { date: string; avgDrift: number; avgSwing: number; rollingDrift: number; rollingSwing: number };
    const typedTrend = dailyTrend as TrendPoint[];

    const areaGen = area<TrendPoint>()
      .x(d => xScale(new Date(d.date)))
      .y0(innerH)
      .y1(d => yScale(d.rollingDrift))
      .curve(curveBasis);

    g.append('path').datum(typedTrend).attr('d', areaGen)
      .attr('fill', 'url(#trendGradient)').attr('opacity', 0.15);

    const lineGen = line<TrendPoint>()
      .x(d => xScale(new Date(d.date)))
      .y(d => yScale(d.rollingDrift))
      .curve(curveBasis);

    g.append('path').datum(typedTrend).attr('d', lineGen)
      .attr('fill', 'none').attr('stroke', 'rgb(226 232 240)').attr('stroke-width', 2);

    g.selectAll('.dot').data(typedTrend).join('circle')
      .attr('cx', d => xScale(new Date(d.date)))
      .attr('cy', d => yScale(d.rollingDrift))
      .attr('r', 2).attr('fill', 'rgb(148 163 184)').attr('opacity', 0.4);

    const minSwing = Math.min(...typedTrend.map(d => d.rollingSwing)) * 0.9;
    const maxSwing = Math.max(...typedTrend.map(d => d.rollingSwing)) * 1.1;
    const swingY = scaleLinear().domain([minSwing, maxSwing]).range([innerH, 0]);

    const swingLine = line<TrendPoint>()
      .x(d => xScale(new Date(d.date)))
      .y(d => swingY(d.rollingSwing))
      .curve(curveBasis);

    g.append('path').datum(typedTrend).attr('d', swingLine)
      .attr('fill', 'none').attr('stroke', '#60a5fa').attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,2');

    // X axis
    g.append('g').attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(xScale).ticks(6).tickFormat((d: any) => {
        const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
        return `${months[new Date(d).getMonth()]}`;
      }) as any)
      .attr('color', 'rgb(100 116 139)').style('font-size', '9px').style('font-family', 'monospace');

    // Hover crosshair
    const tooltip = svg.append('g').attr('class', 'tooltip').style('display', 'none');
    const tooltipRect = tooltip.append('rect').attr('fill', 'rgb(15 23 42)').attr('rx', 4).attr('ry', 4)
      .attr('stroke', 'rgb(71 85 105)').attr('stroke-width', 1);
    const tooltipText = tooltip.append('text').attr('fill', 'rgb(226 232 240)')
      .style('font-size', '9px').style('font-family', 'monospace').attr('x', 8).attr('y', 16);

    const hoverBar = g.append('rect').attr('fill', 'transparent')
      .attr('width', innerW).attr('height', innerH).style('cursor', 'crosshair');

    const hoverLine = g.append('line')
      .attr('stroke', 'rgb(148 163 184)').attr('stroke-width', 1).attr('stroke-dasharray', '3,2')
      .style('display', 'none');

    hoverBar.on('mousemove', (event: any) => {
      const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const date = xScale.invert(mx);
      const nearest = dailyTrend.reduce((best, d) => {
        const dist = Math.abs(new Date(d.date).getTime() - date.getTime());
        return dist < best.dist ? { d, dist } : best;
      }, { d: dailyTrend[0], dist: Infinity }).d;

      const xPos = xScale(new Date(nearest.date));
      hoverLine.style('display', null).attr('x1', xPos).attr('x2', xPos).attr('y1', 0).attr('y2', innerH);

      tooltip.style('display', null);
      const ttX = Math.min(xPos + margin.left + 10, width - 180);
      tooltip.attr('transform', `translate(${ttX},${10})`);
      tooltipText.text(`${nearest.date} · Drift: ${nearest.rollingDrift.toFixed(1)}ms · Swing: ${nearest.rollingSwing.toFixed(1)}%`);
      const bbox = (tooltipText.node() as SVGTextElement)?.getBBox();
      if (bbox) tooltipRect.attr('width', bbox.width + 16).attr('height', bbox.height + 12).attr('y', bbox.y - 6).attr('x', bbox.x - 4);
    }).on('mouseleave', () => {
      tooltip.style('display', 'none');
      hoverLine.style('display', 'none');
    });

    // Gradient def
    svg.select('defs').remove();
    svg.append('defs').append('linearGradient').attr('id', 'trendGradient')
      .attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1')
      .append('stop').attr('offset', '0%').attr('stop-color', 'rgb(226 232 240)').attr('stop-opacity', '0.3');
  }, [dailyTrend]);

  const last = dailyTrend[dailyTrend.length - 1];

  return (
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
        <div className="flex-1 flex items-center justify-center bg-slate-800/40 rounded border border-slate-700/50 p-5 text-slate-400 text-xs font-mono h-[260px]">
          Keine Trend-Daten vorhanden.
        </div>
      ) : (
        <div ref={containerRef} className="relative flex-1 min-h-[260px] bg-slate-800/40 p-4 rounded border border-slate-700/50">
          <svg ref={svgRef} className="w-full" />
        </div>
      )}

      {last && (
        <div className="mt-4 flex flex-col sm:flex-row justify-between items-baseline bg-slate-800/40 p-4 rounded border border-slate-700/50 font-mono text-xs gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-slate-200 rounded-full inline-block" />
            <div>
              <div className="text-[9px] text-slate-500 uppercase">DRIFT</div>
              <div className="font-bold text-slate-200">{last.rollingDrift.toFixed(1)} ms</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-400 rounded-full inline-block" />
            <div>
              <div className="text-[9px] text-slate-500 uppercase">SWING 16TEL</div>
              <div className="font-bold text-blue-400">{last.rollingSwing.toFixed(1)}%</div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 max-w-[120px] sm:text-right leading-tight">
            Swing-Entwicklung über das Halbjahr.
          </p>
        </div>
      )}
    </div>
  );
}
