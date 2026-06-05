import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import cytoscape from 'cytoscape';
// @ts-ignore
import coseBilkent from 'cytoscape-cose-bilkent';
cytoscape.use(coseBilkent);
import {
  Loader2, ZoomIn, ZoomOut, Maximize2,
  RefreshCw, ExternalLink, X, Search,
  GitBranch, Link2, Box,
} from 'lucide-react';
import { getGraph } from '../api';
import { useProject } from '../context';

function useTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark'
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme((document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark')
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ── Layout configurations ─────────────────────────────────────────────────────
function getLayoutConfig(name: 'cose-bilkent' | 'circle' | 'breadthfirst') {
  const base = { animate: true, animationDuration: 700, fit: true, padding: 80 };

  if (name === 'cose-bilkent') {
    return {
      ...base,
      name: 'cose-bilkent',
      // Node repulsion — push nodes apart strongly
      nodeRepulsion: 8500,
      // Ideal edge length — longer = more spread out
      idealEdgeLength: 120,
      // Edge elasticity — how springy edges are
      edgeElasticity: 0.1,
      // Nesting factor for compound graphs
      nestingFactor: 0.1,
      // Pull towards centre
      gravity: 0.15,
      gravityRange: 3.8,
      gravityCompound: 1,
      gravityRangeCompound: 1.5,
      // Prevent overlaps — the key setting
      numIter: 2500,
      tile: true,
      tilingPaddingVertical: 12,
      tilingPaddingHorizontal: 12,
      // Randomise start positions
      randomize: true,
      // Include node labels in collision detection
      nodeDimensionsIncludeLabels: true,
    };
  }

  if (name === 'circle') {
    return { ...base, name: 'circle', spacingFactor: 1.6 };
  }

  // breadthfirst (tree)
  return {
    ...base,
    name: 'breadthfirst',
    directed: false,
    spacingFactor: 1.8,
    maximal: true,
    avoidOverlap: true,
  };
}

// ── colour per collection ─────────────────────────────────────────────────────
const PALETTE = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316',
];
const colCache: Record<string, string> = {};
let colIdx = 0;
function getColor(id: string | undefined) {
  if (!id) return '#6366f1';
  if (!colCache[id]) colCache[id] = PALETTE[colIdx++ % PALETTE.length];
  return colCache[id];
}

// ── types ─────────────────────────────────────────────────────────────────────
interface NodeData {
  id: string;
  title: string;
  node_type: string;
  depth: number;
  collection_id?: string;
  parent_id?: string;
}

interface EdgeData {
  source: string;
  target: string;
  relation_type: string;
}

interface Selected {
  id: string;
  title: string;
  color: string;
  node_type: string;
  collection_id?: string;
  degree: number;
  wikiLinks: number;
  totalMembers?: number; // for collection nodes: all pages including nested
}

export default function GraphPage() {
  const nav = useNavigate();
  const { project } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [selected, setSelected] = useState<Selected | null>(null);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'cose-bilkent' | 'circle' | 'breadthfirst'>('cose-bilkent');

  // ── build / rebuild ─────────────────────────────────────────────────────────
  const build = useCallback(async (nodes?: NodeData[], edges?: EdgeData[]) => {
    if (!containerRef.current) return;

    let graphNodes = nodes;
    let graphEdges = edges;

    if (!graphNodes) {
      setLoading(true);
      setErr('');
      try {
        const g = await getGraph(project?.id ?? '');
        graphNodes = g.nodes as NodeData[];
        graphEdges = g.edges as EdgeData[];
      } catch (e: any) {
        setErr(e.message);
        setLoading(false);
        return;
      }
    }

    // Filter out edges whose source or target isn't in the node list
    // (stale relations referencing deleted/cross-project documents)
    const nodeIds = new Set(graphNodes!.map(n => n.id));
    const safeEdges = graphEdges!.filter(
      e => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    setStats({ nodes: graphNodes!.length, edges: safeEdges.length });
    setSelected(null);
    cyRef.current?.destroy();

    // degree map for node sizing
    const degreeMap: Record<string, number> = {};
    safeEdges.forEach(e => {
      degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
    });

    let cy: cytoscape.Core;
    try {
    cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graphNodes!.map(n => ({
          data: {
            id: n.id,
            label: n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title,
            fullLabel: n.title,
            node_type: n.node_type,
            collection_id: n.collection_id,
            // collections get their own fixed accent colour; docs colour by collection
            color: n.node_type === 'collection' ? '#f59e0b' : getColor(n.collection_id),
            depth: n.depth,
            degree: degreeMap[n.id] || 0,
          },
        })),
        ...safeEdges.map((e, i) => ({
          data: {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            relation: e.relation_type,
          },
        })),
      ],
      style: [
        // ── nodes ──
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.85,
            'label': 'data(label)',
            'color': theme === 'dark' ? '#f1f5f9' : '#1a1a1a',
            'font-size': '11px',
            'font-weight': '500',
            'font-family': '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 5,
            'text-outline-color': theme === 'dark' ? '#0a0a0a' : '#ffffff',
            'text-outline-width': 3,
            'width': 'mapData(degree, 0, 10, 24, 56)',
            'height': 'mapData(degree, 0, 10, 24, 56)',
            'border-width': 0,
            'shadow-blur': 12,
            'shadow-color': 'data(color)',
            'shadow-opacity': 0.4,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'transition-property': 'width, height, border-width, shadow-blur, shadow-opacity, background-opacity',
            'transition-duration': 150,
            'z-index': 10,
          } as any,
        },
        // ── collection nodes — larger, diamond shape via rotation ──
        {
          selector: 'node[node_type="collection"]',
          style: {
            'shape': 'round-rectangle',
            'width': 'mapData(degree, 0, 10, 48, 72)',
            'height': 'mapData(degree, 0, 10, 36, 52)',
            'border-width': 2,
            'border-color': '#fbbf24',
            'border-opacity': 0.8,
            'background-opacity': 0.95,
            'font-size': '12px',
            'font-weight': '700',
            'text-margin-y': 6,
            'shadow-blur': 20,
            'shadow-opacity': 0.6,
            'z-index': 50,
          } as any,
        },
        {
          selector: 'node[node_type="collection"]:selected',
          style: {
            'border-width': 3,
            'border-color': '#fff',
            'shadow-blur': 32,
            'shadow-opacity': 1,
            'z-index': 999,
          } as any,
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#fff',
            'border-opacity': 0.9,
            'shadow-blur': 24,
            'shadow-opacity': 0.8,
            'background-opacity': 1,
            'z-index': 999,
          } as any,
        },
        {
          selector: 'node.hovered',
          style: {
            'border-width': 2,
            'border-color': '#fff',
            'border-opacity': 0.6,
            'shadow-blur': 20,
            'shadow-opacity': 0.6,
            'background-opacity': 1,
            'z-index': 100,
          } as any,
        },
        {
          selector: 'node.faded',
          style: {
            'opacity': 0.12,
            'z-index': 1,
          } as any,
        },
        // ── edges ──
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#334155',
            'target-arrow-color': '#334155',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'curve-style': 'bezier',
            'opacity': 0.6,
            'z-index': 5,
            'transition-property': 'opacity, width, line-color',
            'transition-duration': 150,
          } as any,
        },
        {
          selector: 'edge[relation="wiki_link"]',
          style: {
            'line-color': '#6366f1',
            'target-arrow-color': '#6366f1',
            'opacity': 0.7,
            'width': 2,
          } as any,
        },
        {
          selector: 'edge[relation="collection_member"]',
          style: {
            'line-color': '#f59e0b',
            'target-arrow-color': '#f59e0b',
            'target-arrow-shape': 'triangle',
            'opacity': 0.5,
            'width': 1.5,
            'line-style': 'dashed',
            'line-dash-pattern': [6, 3],
          } as any,
        },
        {
          selector: 'edge[relation="parent_child"]',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': [5, 4],
            'line-color': '#475569',
            'target-arrow-color': '#475569',
            'opacity': 0.5,
          } as any,
        },
        {
          selector: 'edge.highlighted',
          style: {
            'opacity': 1,
            'width': 2.5,
            'z-index': 20,
          } as any,
        },
        {
          selector: 'edge.faded',
          style: { 'opacity': 0.05, 'z-index': 1 } as any,
        },
      ],
      layout: getLayoutConfig(layout),
      wheelSensitivity: 0.25,
      minZoom: 0.05,
      maxZoom: 5,
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;

    // hover — for collections, also highlight all member pages (including nested)
    cy.on('mouseover', 'node', e => {
      e.target.addClass('hovered');
      let highlighted;
      if (e.target.data('node_type') === 'collection') {
        const colId = e.target.id();
        const members = cy.nodes(`[collection_id="${colId}"]`);
        highlighted = e.target.closedNeighborhood().union(members);
      } else {
        highlighted = e.target.closedNeighborhood();
      }
      cy.elements().not(highlighted).addClass('faded');
      highlighted.edges().addClass('highlighted');
    });
    cy.on('mouseout', 'node', e => {
      e.target.removeClass('hovered');
      cy.elements().removeClass('faded highlighted');
    });

    // select → show panel
    cy.on('tap', 'node', e => {
      const node = e.target;
      const wikiLinks = node.connectedEdges('[relation="wiki_link"]').length;
      const isCollection = node.data('node_type') === 'collection';
      const totalMembers = isCollection
        ? cy.nodes(`[collection_id="${node.id()}"]`).length
        : undefined;
      setSelected({
        id: node.id(),
        title: node.data('fullLabel'),
        color: node.data('color'),
        node_type: node.data('node_type'),
        collection_id: node.data('collection_id'),
        degree: degreeMap[node.id()] || 0,
        wikiLinks,
        totalMembers,
      });
    });

    // deselect on background tap
    cy.on('tap', evt => {
      if (evt.target === cy) setSelected(null);
    });

    } catch (cyErr: any) {
      console.error('Cytoscape init error:', cyErr);
      setErr('Failed to render graph: ' + cyErr.message);
    }

    setLoading(false);
  }, [layout, project?.id]);

  useEffect(() => {
    build();
    return () => cyRef.current?.destroy();
  }, [project?.id, theme]);

  // search highlight
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!query) { cy.elements().removeClass('faded'); return; }
    const q = query.toLowerCase();
    cy.nodes().forEach(n => {
      const match = n.data('fullLabel').toLowerCase().includes(q);
      match ? n.removeClass('faded') : n.addClass('faded');
    });
    cy.edges().addClass('faded');
  }, [query]);

  const reLayout = (name: 'cose-bilkent' | 'circle' | 'breadthfirst') => {
    setLayout(name);
    cyRef.current?.layout(getLayoutConfig(name) as any).run();
  };

  const zoom = (dir: 1 | -1) => {
    const cy = cyRef.current;
    if (!cy) return;
    const centre = { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 };
    cy.zoom({ level: cy.zoom() * (dir > 0 ? 1.35 : 0.75), renderedPosition: centre });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>

      {/* ── toolbar ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: 'var(--bg2)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0, zIndex: 20,
      }}>
        {/* title + stats */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>Knowledge Graph</span>
          {!loading && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Chip icon={<Box size={10} />} label={`${stats.nodes} pages`} />
              <Chip icon={<Link2 size={10} />} label={`${stats.edges} links`} />
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* search */}
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter nodes…"
            style={{
              width: 160, paddingLeft: 30, paddingRight: 10, height: 30,
              background: 'var(--bg3)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text)', fontSize: 12,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* layout */}
        <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['cose-bilkent', 'circle', 'breadthfirst'] as const).map(l => (
            <button
              key={l}
              onClick={() => reLayout(l)}
              style={{
                padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11,
                fontFamily: 'inherit',
                background: layout === l ? 'var(--accent)' : 'transparent',
                color: layout === l ? '#fff' : 'var(--text2)',
                fontWeight: layout === l ? 600 : 400,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {l === 'cose-bilkent' ? 'Force' : l === 'circle' ? 'Circle' : 'Tree'}
            </button>
          ))}
        </div>

        {/* zoom controls */}
        <div style={{ display: 'flex', gap: 2 }}>
          <IconBtn onClick={() => zoom(1)} title="Zoom in"><ZoomIn size={14} /></IconBtn>
          <IconBtn onClick={() => zoom(-1)} title="Zoom out"><ZoomOut size={14} /></IconBtn>
          <IconBtn onClick={() => cyRef.current?.fit(undefined, 60)} title="Fit"><Maximize2 size={14} /></IconBtn>
          <IconBtn onClick={() => build()} title="Refresh"><RefreshCw size={14} /></IconBtn>
        </div>
      </div>

      {/* ── canvas area ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* dot-grid background */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
          backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          opacity: 0.5,
        }} />

        {/* ── selected node panel ───────────────────────────────────────────── */}
        {selected && (
          <div style={{
            position: 'absolute', top: 16, right: 16,
            width: 230,
            background: 'var(--bg2)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 16px 48px rgba(0,0,0,.3)',
            zIndex: 30,
            animation: 'panel-in 0.18s ease-out',
          }}>
            {/* colour bar */}
            <div style={{ height: 4, background: selected.color }} />
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, flex: 1 }}>{selected.title}</span>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 2, flexShrink: 0, marginTop: 1 }}>
                  <X size={13} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {selected.totalMembers !== undefined && (
                  <StatRow icon={<Box size={11} />} label="Total pages" value={selected.totalMembers} />
                )}
                <StatRow icon={<Link2 size={11} />} label="Direct links" value={selected.degree} />
                <StatRow icon={<GitBranch size={11} />} label="Wiki links" value={selected.wikiLinks} />
              </div>

              <button
                onClick={() => nav(selected.node_type === 'collection' ? `/collections/${selected.id}` : `/doc/${selected.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  width: '100%', padding: '7px 0',
                  background: selected.color, border: 'none', borderRadius: 7,
                  color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  cursor: 'pointer', transition: 'opacity 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                <ExternalLink size={13} /> {selected.node_type === 'collection' ? 'Open Collection' : 'Open Page'}
              </button>
            </div>
          </div>
        )}

        {/* ── legend ───────────────────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute', bottom: 16, left: 16,
          background: 'var(--bg2)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 14px',
          zIndex: 20, fontSize: 11, color: 'var(--text2)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Legend</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <LegendRow>
              <div style={{ width: 18, height: 12, borderRadius: 3, background: '#f59e0b', border: '2px solid #fbbf24', boxShadow: '0 0 6px #f59e0b' }} />
              <span>Collection</span>
            </LegendRow>
            <LegendRow>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)' }} />
              <span>Page (colour = collection)</span>
            </LegendRow>
            <LegendRow>
              <div style={{ width: 24, height: 2, background: '#6366f1', borderRadius: 1 }} />
              <span>Wiki link</span>
            </LegendRow>
            <LegendRow>
              <div style={{ width: 24, height: 0, borderTop: '2px dashed #f59e0b' }} />
              <span>Collection member</span>
            </LegendRow>
            <LegendRow>
              <div style={{ width: 24, height: 0, borderTop: '2px dashed #475569' }} />
              <span>Parent → child</span>
            </LegendRow>
          </div>
        </div>

        {/* ── tip ─────────────────────────────────────────────────────────────── */}
        {!selected && !loading && stats.nodes > 0 && (
          <div style={{ position: 'absolute', bottom: 16, right: 16, fontSize: 11, color: 'var(--muted)', background: 'rgba(26,26,26,0.7)', backdropFilter: 'blur(8px)', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            Hover to highlight · Click to inspect · Scroll to zoom
          </div>
        )}

        {/* loading */}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'rgba(15,15,15,0.8)', backdropFilter: 'blur(4px)', zIndex: 40 }}>
            <Loader2 size={28} className="spin" style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, color: 'var(--text2)' }}>Building graph…</span>
          </div>
        )}

        {/* error */}
        {err && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 40 }}>
            <span style={{ color: 'var(--danger)', fontSize: 14 }}>{err}</span>
            <button className="btn" onClick={() => build()}>Retry</button>
          </div>
        )}

        {/* empty */}
        {stats.nodes === 0 && !loading && !err && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 40 }}>
            <span style={{ fontSize: 48, lineHeight: 1 }}>🕸️</span>
            <span style={{ fontSize: 15, color: 'var(--text2)', fontWeight: 600 }}>No pages yet</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Create some pages and link them with [[brackets]]</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes panel-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────
function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, border: '1px solid var(--border)',
        borderRadius: 6, background: 'var(--bg3)', color: 'var(--text2)',
        cursor: 'pointer', transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--text)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--text2)'; }}
    >
      {children}
    </button>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 20, fontSize: 11, color: 'var(--text2)' }}>
      {icon}{label}
    </span>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text2)' }}>{icon}{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function LegendRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
  );
}
