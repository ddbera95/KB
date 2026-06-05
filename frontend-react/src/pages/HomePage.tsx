import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Layers, Plus, Search, Network } from 'lucide-react';
import type { Document, Collection } from '../types';
import { listDocuments, getCollections, createDocument } from '../api';
import { useProject } from '../context';

export default function HomePage() {
  const nav = useNavigate();
  const { project } = useProject();
  const [recent, setRecent] = useState<Document[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    if (!project) return;
    Promise.all([
      listDocuments({ project_id: project.id, per_page: '8' }),
      getCollections(project.id),
    ]).then(([docs, cols]) => {
      setRecent(docs.data);
      setCollections(cols);
    }).catch(console.error);
  }, [project?.id]);

  const newPage = async () => {
    if (!project) return;
    try {
      const doc = await createDocument({ title: 'Untitled', content: '[]', project_id: project.id });
      nav(`/doc/${doc.id}`);
    } catch {}
  };

  return (
    <div className="page-scroll">
      <div className="home-wrap">
        {/* Logo */}
        <img
          src="/mimix-logo.svg"
          alt="Mimix"
          style={{ height: 52, width: 'auto', marginBottom: 10, display: 'block', maxWidth: 300 }}
        />
        <p style={{ fontSize: 15, color: 'var(--text2)', marginBottom: 32, fontStyle: 'italic' }}>
          Knowledge, without the noise.
        </p>

        <div className="home-grid">
          <div className="home-card" onClick={newPage}>
            <div className="home-card-title"><Plus size={14} style={{ marginRight: 6 }} />New Page</div>
            <div className="home-card-sub">Create a blank page</div>
          </div>
          <div className="home-card" onClick={() => nav('/search')}>
            <div className="home-card-title"><Search size={14} style={{ marginRight: 6 }} />Search</div>
            <div className="home-card-sub">Full-text search across all pages</div>
          </div>
          <div className="home-card" onClick={() => nav('/collections')}>
            <div className="home-card-title"><Layers size={14} style={{ marginRight: 6 }} />Collections</div>
            <div className="home-card-sub">{collections.length} collection{collections.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="home-card" onClick={() => nav('/graph')}>
            <div className="home-card-title"><Network size={14} style={{ marginRight: 6 }} />Graph View</div>
            <div className="home-card-sub">Visualise page connections</div>
          </div>
        </div>

        {recent.length > 0 && (
          <>
            <div className="section-hd">
              <h2>Recent Pages</h2>
            </div>
            <div className="recent-list">
              {recent.map(doc => (
                <div key={doc.id} className="recent-item" onClick={() => nav(`/doc/${doc.id}`)}>
                  <FileText size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                    {doc.brief && <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.brief}</div>}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                    {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(doc.updated_at * 1000))}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
