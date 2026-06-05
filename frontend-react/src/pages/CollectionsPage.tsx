import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Layers, Loader2 } from 'lucide-react';
import type { Collection } from '../types';
import { getCollections, createCollection } from '../api';
import { useProject } from '../context';

export default function CollectionsPage() {
  const nav = useNavigate();
  const { project } = useProject();
  const [cols, setCols] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project) { setLoading(false); return; }
    getCollections(project.id).then(setCols).finally(() => setLoading(false));
  }, [project?.id]);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const col = await createCollection({ name: name.trim(), description: desc.trim() || undefined }, project?.id ?? '');
      setCols(p => [...p, col]);
      setShowNew(false); setName(''); setDesc('');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="center"><Loader2 size={22} className="spin" /></div>;

  return (
    <div className="page-scroll">
      <div className="home-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 className="home-title" style={{ marginBottom: 0 }}>Collections</h1>
          <button className="btn primary" onClick={() => setShowNew(true)}><Plus size={14} /> New</button>
        </div>

        {cols.length === 0
          ? <div className="center" style={{ paddingTop: 60 }}><Layers size={32} style={{ color: 'var(--muted)' }} /><p>No collections yet.</p></div>
          : <div className="home-grid">
            {cols.map(col => (
              <div key={col.id} className="home-card" onClick={() => nav(`/collections/${col.id}`)}>
                <div className="home-card-title">{col.icon && <>{col.icon} </>}{col.name}</div>
                {col.description && <div className="home-card-sub">{col.description}</div>}
              </div>
            ))}
          </div>
        }
      </div>

      {showNew && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <span className="modal-title">New Collection</span>
              <button className="btn icon-btn" onClick={() => setShowNew(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label className="modal-label">Name</label>
              <input className="modal-input" placeholder="Collection name…" value={name} autoFocus onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
              <label className="modal-label" style={{ marginTop: 12, display: 'block' }}>Description (optional)</label>
              <input className="modal-input" placeholder="Brief description…" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn primary" onClick={create} disabled={saving || !name.trim()}>
                {saving ? <Loader2 size={13} className="spin" /> : null} Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
