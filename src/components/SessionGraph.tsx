import { useMemo, useRef, useEffect, useState } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter,
  forceCollide, forceX, forceY, drag, zoom as d3zoom,
  select, SimulationNodeDatum,
} from 'd3';
import { AlsFileStats } from '../types';

interface GraphNode extends SimulationNodeDatum {
  id: string;
  session: AlsFileStats;
  index: number;
}

interface GraphLink {
  source: string;
  target: string;
  strength: number;
}

interface Props {
  sessions: AlsFileStats[];
  onSelectSession: (idx: number) => void;
}

function computeSimilarity(a: AlsFileStats, b: AlsFileStats): number {
  const normDiff = (va: number, vb: number, max: number) =>
    1 - Math.min(Math.abs(va - vb) / max, 1);

  const tempoSim = normDiff(
    a.estimatedBpm ?? a.tempo,
    b.estimatedBpm ?? b.tempo,
    60
  );
  const driftSim = normDiff(a.avgDriftMs, b.avgDriftMs, 50);
  const velSim = normDiff(a.avgVelocity, b.avgVelocity, 80);
  const swingSim = normDiff(a.swingFactor16th, b.swingFactor16th, 30);
  const weekdaySim = a.weekday === b.weekday ? 1 : 0;

  return tempoSim * 0.25 + driftSim * 0.25 + velSim * 0.2 + swingSim * 0.15 + weekdaySim * 0.15;
}

const COLORS = {
  tight: '#34d399',
  human: '#60a5fa',
  loose: '#fb923c',
  sloppy: '#f87171',
};

function driftColor(drift: number): string {
  if (drift < 12) return COLORS.tight;
  if (drift < 20) return COLORS.human;
  if (drift < 30) return COLORS.loose;
  return COLORS.sloppy;
}

function driftLabel(drift: number): string {
  if (drift < 12) return 'Tight';
  if (drift < 20) return 'Groove';
  if (drift < 30) return 'Locker';
  return 'Offbeat';
}

export default function SessionGraph({ sessions, onSelectSession }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const simRef = useRef<any>(null);

  const { nodes, links } = useMemo(() => {
    const n: GraphNode[] = sessions.map((s, i) => ({
      id: `${s.date}-${s.fileName}-${i}`,
      session: s,
      index: i,
    }));

    const l: GraphLink[] = [];
    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        const sim = computeSimilarity(n[i].session, n[j].session);
        if (sim > 0.5) {
          l.push({ source: n[i].id, target: n[j].id, strength: sim });
        }
      }
    }
    return { nodes: n, links: l };
  }, [sessions]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svgEl = svgRef.current;
    const width = containerRef.current?.clientWidth ?? 800;
    const height = containerRef.current?.clientHeight ?? 600;

    select(svgEl).selectAll('*').remove();
    const svg = select(svgEl).attr('width', width).attr('height', height);
    const g = svg.append('g');

    // Zoom/Pan
    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    const linkElements = g.append('g')
      .selectAll('line')
      .data(links as any)
      .join('line')
      .attr('stroke', 'rgb(51 65 85)')
      .attr('stroke-width', (d: any) => Math.max(0.5, d.strength * 3))
      .attr('opacity', (d: any) => 0.2 + d.strength * 0.4);

    const nodeGroup = g.append('g')
      .selectAll('g')
      .data(nodes as any)
      .join('g')
      .style('cursor', 'pointer');

    nodeGroup.append('circle')
      .attr('r', (d: any) => Math.max(5, Math.min(25, Math.sqrt(d.session.notesCount) * 0.5)))
      .attr('fill', (d: any) => driftColor(d.session.avgDriftMs))
      .attr('stroke', 'rgb(30 41 59)')
      .attr('stroke-width', 2)
      .attr('opacity', 0.85);

    // Drag
    const dragHandler = drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x ?? null;
        d.fy = d.y ?? null;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simRef.current?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeGroup.call(dragHandler);

    // Hover tooltip
    nodeGroup.on('mouseenter', (event, d) => {
      const rect = svgEl.getBoundingClientRect();
      setHoveredNode(d);
      setTooltipPos({
        x: event.clientX - rect.left + 12,
        y: event.clientY - rect.top - 10,
      });
    }).on('mouseleave', () => {
      setHoveredNode(null);
    }).on('click', (_event: any, d: any) => {
      onSelectSession(d.index);
    });

    const sim = forceSimulation(nodes as any)
      .force('link', forceLink(links as any).id((d: any) => d.id).distance((d: any) => 200 - d.strength * 150))
      .force('charge', forceManyBody().strength(-300))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide().radius((d: any) => Math.max(10, Math.sqrt(d.session.notesCount) * 0.5 + 10)))
      .force('x', forceX(width / 2).strength(0.05))
      .force('y', forceY(height / 2).strength(0.05))
      .on('tick', () => {
        linkElements
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);
        nodeGroup.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });

    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [nodes, links, onSelectSession]);

  const stats = useMemo(() => {
    if (nodes.length === 0) return null;
    const avgDrift = nodes.reduce((s, n) => s + n.session.avgDriftMs, 0) / nodes.length;
    const avgTempo = nodes.reduce((s, n) => s + (n.session.estimatedBpm ?? n.session.tempo), 0) / nodes.length;
    const totalNotes = nodes.reduce((s, n) => s + n.session.notesCount, 0);
    return {
      avgDrift, avgTempo, totalNotes,
      nodeCount: nodes.length, linkCount: links.length,
    };
  }, [nodes, links]);

  return (
    <div className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-bold tracking-widest text-slate-200 uppercase font-mono">
            SESSION-NETZWERK
          </h3>
          <p className="text-[10px] text-slate-500 mt-1 italic font-serif">
            Kraftgerichteter Graph – jeder Punkt ist eine Session, Linien zeigen Ähnlichkeit
          </p>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400">
            <span>{stats.nodeCount} Sessions</span>
            <span>{stats.linkCount} Verbindungen</span>
            <span>{stats.totalNotes.toLocaleString()} Noten</span>
            <span className={`px-2 py-0.5 rounded font-bold ${
              stats.avgDrift < 12 ? 'text-emerald-400 bg-emerald-500/10' :
              stats.avgDrift < 20 ? 'text-blue-400 bg-blue-500/10' :
              'text-amber-400 bg-amber-500/10'
            }`}>
              ø {stats.avgDrift.toFixed(1)}ms
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mb-3 text-[9px] font-mono text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> Tight (&lt;12ms)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" /> Groove (12-20ms)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" /> Locker (20-30ms)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Offbeat (&gt;30ms)
        </span>
        <span className="ml-auto text-slate-600">Größe = Noten</span>
      </div>

      <div
        ref={containerRef}
        className="relative w-full bg-slate-950/50 border border-slate-700/50 rounded overflow-hidden"
        style={{ minHeight: '500px', height: '60vh' }}
      >
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs font-mono">
            Keine Sessions zum Darstellen.
          </div>
        ) : (
          <>
            <svg ref={svgRef} className="w-full h-full" />
            {hoveredNode && (
              <div
                className="absolute bg-slate-900 border border-slate-600 rounded px-3 py-2 pointer-events-none z-10 shadow-xl"
                style={{ left: tooltipPos.x, top: tooltipPos.y, transform: 'translateY(-100%)' }}
              >
                <div className="text-xs font-bold text-slate-200 font-mono whitespace-nowrap">
                  {hoveredNode.session.fileName}
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-1 space-y-0.5">
                  <div>{hoveredNode.session.date} · {hoveredNode.session.estimatedBpm ?? hoveredNode.session.tempo} BPM</div>
                  <div>
                    Drift: <span className={driftColor(hoveredNode.session.avgDriftMs) === COLORS.tight ? 'text-emerald-400' : driftColor(hoveredNode.session.avgDriftMs) === COLORS.human ? 'text-blue-400' : driftColor(hoveredNode.session.avgDriftMs) === COLORS.loose ? 'text-orange-400' : 'text-red-400'}>{hoveredNode.session.avgDriftMs.toFixed(1)}ms</span>
                    {' · '}Velocity: {hoveredNode.session.avgVelocity}
                  </div>
                  <div>{driftLabel(hoveredNode.session.avgDriftMs)} · {hoveredNode.session.notesCount.toLocaleString()} Noten</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-2 text-[9px] text-slate-600 font-mono text-center">
        Ziehen zum Bewegen · Klick für Details · Scrollen zum Zoomen
      </div>
    </div>
  );
}
