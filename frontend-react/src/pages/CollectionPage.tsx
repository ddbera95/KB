import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, FileText, ChevronRight, Loader2, Trash2, Edit2, Check, X } from 'lucide-react';
import type { Collection, Document } from '../types';
import { getCollection, createDocument, deleteCollection, updateCollection } from '../api';

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDel, setShowDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getCollection(id)
      .then(({ collection: col, root_docs }) => {
        setCollection(col);
        setDocs(root_docs);
        setNameVal(col.name);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const newPage = async () => {
    if (!id) return;
    try {
      const doc = await createDocument({ title: 'Untitled', collection_id: id, content: '[]' });
      setDocs(p => [...p, doc]);
      nav(`/doc/${doc.id}`);
    } catch { showToast('Failed to create page'); }
  };

  const saveName = async () => {
    if (!collection || !nameVal.trim()) return;
    setSaving(true);
    try {
      const updated = await updateCollection(collection.id, { name: nameVal.trim() });
      setCollection(updated);
      setEditingName(false);
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!collection) return;
    setDeleting(true);
    try {
      await deleteCollection(collection.id);
      nav('/collections');
    } catch { showToast('Delete failed'); }
    finally { setDeleting(false); setShowDel(false); }
  };

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function fmt(ts: number) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
      new Date(ts > 1e10 ? ts : ts * 1000)
    );
  }

  if (loading) return <div className="center"><Loader2 size={22} className="spin" /></div>;
  if (err || !collection) return (
    <div className="center" style={{ color: 'var(--danger)' }}>
      {err || 'Collection not found'}
      <Link to="/collections" className="btn" style={{ marginTop: 8 }}>← Collections</Link>
    </div>
  );

  return (
    <>
      <div className="topbar">
        <div className="breadcrumb">
          <Link to="/collections">Collections</Link>
          <ChevronRight size={12} />
          <span className="current">{collection.name}</span>
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={() => setEditingName(true)} title="Rename">
            <Edit2 size={13} /> Rename
          </button>
          <button className="btn danger" onClick={() => setShowDel(true)}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      <div className="page-scroll">
        <div className="page-inner">

          {/* collection title */}
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
              <input
                className="doc-title"
                style={{ fontSize: '1.75rem', marginBottom: 0 }}
                value={nameVal}
                autoFocus
                onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              />
              <button className="btn primary" onClick={saveName} disabled={saving}>
                {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
              </button>
              <button className="btn" onClick={() => setEditingName(false)}><X size={13} /></button>
            </div>
          ) : (
            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.025em', marginBottom: 6, cursor: 'pointer' }}
              onDoubleClick={() => setEditingName(true)}>
              {collection.icon && <>{collection.icon} </>}{collection.name}
            </h1>
          )}

          {collection.description && (
            <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>{collection.description}</p>
          )}

          {/* stats row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
              <div style={{ color: 'var(--muted)', marginBottom: 2 }}>Pages</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{docs.length}</div>
            </div>
            <div style={{ padding: '10px 16px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
              <div style={{ color: 'var(--muted)', marginBottom: 2 }}>Created</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{fmt(collection.created_at)}</div>
            </div>
          </div>

          {/* pages list */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Pages
            </h2>
            <button className="btn primary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={newPage}>
              <Plus size={13} /> New Page
            </button>
          </div>

          {docs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <FileText size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <p style={{ fontSize: 14 }}>No pages yet.</p>
              <button className="btn primary" style={{ marginTop: 12 }} onClick={newPage}>
                <Plus size={13} /> Create first page
              </button>
            </div>
          ) : (
            <div className="card-list">
              {docs.map(doc => (
                <div key={doc.id} className="card" onClick={() => nav(`/doc/${doc.id}`)}>
                  <FileText size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  <div className="card-info">
                    <div className="card-title">{doc.title}</div>
                    {doc.brief && <div className="card-sub">{doc.brief}</div>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmt(doc.updated_at)}</span>
                  <ChevronRight size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* delete modal */}
      {showDel && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <span className="modal-title">Delete Collection</span>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6 }}>
                Delete <strong style={{ color: 'var(--text)' }}>{collection.name}</strong>?
                Pages inside will lose their collection but won't be deleted.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setShowDel(false)}>Cancel</button>
              <button className="btn danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
