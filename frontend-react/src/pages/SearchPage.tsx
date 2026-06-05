import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import type { SearchResult } from '../types';
import { search } from '../api';
import { useProject } from '../context';

export default function SearchPage() {
  const nav = useNavigate();
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = { current: 0 as any };

  const run = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await search(query, { project_id: project?.id ?? '' });
      setResults(res.results);
    } finally { setLoading(false); }
  }, [project?.id]);

  useEffect(() => { if (q) run(q); }, []);

  const onChange = (val: string) => {
    setQ(val);
    setParams(val ? { q: val } : {});
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(val), 300);
  };

  return (
    <div className="page-scroll">
      <div className="search-wrap">
        <div style={{ position: 'relative', marginBottom: 24 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input
            className="search-input"
            style={{ paddingLeft: 42 }}
            placeholder="Search across all pages…"
            value={q}
            autoFocus
            onChange={e => onChange(e.target.value)}
          />
          {loading && <Loader2 size={16} className="spin" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />}
        </div>

        {results.length === 0 && q && !loading && (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>No results for "{q}".</p>
        )}

        {results.map(r => (
          <div key={r.id} className="search-result" onClick={() => nav(`/doc/${r.id}`)}>
            <div className="search-result-title">{r.title}</div>
            {r.snippet && <div className="search-result-snippet">{r.snippet}</div>}
            {r.breadcrumb.length > 0 && (
              <div className="search-result-crumb">
                {r.breadcrumb.map(b => b.title).join(' › ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
