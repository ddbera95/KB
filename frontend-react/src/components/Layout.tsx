import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, Plus, ChevronRight, ChevronDown,
  FileText, Network, Layers, BookOpen,
  MoreHorizontal, Trash2, Edit2, FolderOpen,
  HardDrive, Loader2,
} from 'lucide-react';
import type { Collection, Document, Project } from '../types';
import {
  getCollections, getCollection, getDocumentChildren,
  createDocument, createCollection,
  deleteProject, updateProject, createBackup,
} from '../api';
import { useProject } from '../context';

// ── Recursive doc tree node ───────────────────────────────────────────────────
function DocNode({ doc, depth = 0 }: { doc: Document; depth?: number }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Document[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const isActive = loc.pathname === `/doc/${doc.id}`;

  const toggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && !loaded) {
      setLoading(true);
      try {
        const kids = await getDocumentChildren(doc.id);
        setChildren(kids);
        setLoaded(true);
      } catch {}
      finally { setLoading(false); }
    }
    setOpen(p => !p);
  }, [open, loaded, doc.id]);

  const addChild = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const newDoc = await createDocument({
        title: 'Untitled', parent_id: doc.id,
        collection_id: doc.collection_id ?? undefined,
        content: '[]',
      });
      const kids = await getDocumentChildren(doc.id);
      setChildren(kids); setLoaded(true); setOpen(true);
      nav(`/doc/${newDoc.id}`);
    } catch {}
  }, [doc.id, doc.collection_id, nav]);

  return (
    <div>
      <div
        className={`doc-child-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 12, paddingRight: 6, display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => nav(`/doc/${doc.id}`)}
      >
        <button onClick={toggle} style={{ background: 'none', border: 'none', padding: '0 2px', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {loading ? <span style={{ fontSize: 9 }}>…</span> : open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <FileText size={12} style={{ flexShrink: 0, color: 'var(--muted)' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{doc.title}</span>
        <button onClick={addChild} title="New sub-page" className="doc-add-btn"
          style={{ background: 'none', border: 'none', padding: '1px 2px', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0, display: 'flex', opacity: 0 }}>
          <Plus size={11} />
        </button>
      </div>
      {open && children.length > 0 && children.map(c => <DocNode key={c.id} doc={c} depth={depth + 1} />)}
      {open && loaded && children.length === 0 && (
        <div style={{ paddingLeft: 10 + depth * 12 + 22, fontSize: 11.5, color: 'var(--muted)', paddingTop: 2, paddingBottom: 2 }}>No sub-pages</div>
      )}
    </div>
  );
}



// ── Project Switcher ──────────────────────────────────────────────────────────
// ── Project row inside the dropdown (with ⋯ menu) ────────────────────────────
function DropdownProjectRow({
  p, isCurrent, onSwitch, onRename, onDelete,
}: {
  p: Project; isCurrent: boolean;
  onSwitch: () => void; onRename: (name: string) => void; onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(p.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const submitRename = () => {
    if (nameVal.trim() && nameVal.trim() !== p.name) onRename(nameVal.trim());
    setEditing(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px 6px 14px',
      background: isCurrent ? 'var(--bg3)' : 'transparent',
      borderLeft: isCurrent ? `3px solid ${p.color}` : '3px solid transparent',
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />

      {editing ? (
        <input
          autoFocus
          value={nameVal}
          onChange={e => setNameVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditing(false); }}
          onBlur={submitRename}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 6px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
        />
      ) : (
        <button
          onClick={onSwitch}
          style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontSize: 13, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? 'var(--text)' : 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {p.name}
        </button>
      )}

      {/* ⋯ */}
      <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setMenuOpen(v => !v)}
          style={{ background: 'none', border: 'none', padding: '2px 4px', color: 'var(--muted)', cursor: 'pointer', display: 'flex', borderRadius: 4 }}
          title="Options"
        >
          <MoreHorizontal size={13} />
        </button>
        {menuOpen && (
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 2, width: 148, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7, padding: 4, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,.6)' }}>
            <button className="sidebar-item" style={{ gap: 8, fontSize: 12.5 }} onClick={() => { setEditing(true); setMenuOpen(false); }}>
              <Edit2 size={12} /> Rename
            </button>
            {p.id !== 'default' && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
                <button className="sidebar-item" style={{ gap: 8, fontSize: 12.5, color: 'var(--danger)' }} onClick={() => { onDelete(); setMenuOpen(false); }}>
                  <Trash2 size={12} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compact project switcher ──────────────────────────────────────────────────
function ProjectSwitcher() {
  const nav = useNavigate();
  const { project, projects, setProject, refreshProjects } = useProject();
  const [open, setOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleRename = async (p: Project, name: string) => {
    try { await updateProject(p.id, { name }); await refreshProjects(); } catch {}
  };
  const handleDelete = async () => {
    if (!deletingProject) return;
    try {
      await deleteProject(deletingProject.id);
      await refreshProjects();
    } catch {}
    setDeletingProject(null);
  };

  return (
    <>
      <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
        {/* ── trigger: shows current project ── */}
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '9px 12px', background: 'var(--bg2)', border: 'none',
            borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: project?.color ?? '#6366f1', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project?.name ?? 'Select project'}
          </span>
          <ChevronDown size={12} style={{ color: 'var(--muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>

        {/* ── dropdown: all projects + options ── */}
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderTop: 'none', boxShadow: '0 8px 28px rgba(0,0,0,.5)',
            borderRadius: '0 0 8px 8px', paddingBottom: 4,
            // No overflow:hidden — lets the ⋯ submenu render outside the container
          }}>
            <div style={{ padding: '6px 14px 4px', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Projects
            </div>
            {projects.map(p => (
              <DropdownProjectRow
                key={p.id}
                p={p}
                isCurrent={project?.id === p.id}
                onSwitch={() => { setProject(p); setOpen(false); }}
                onRename={name => handleRename(p, name)}
                onDelete={() => setDeletingProject(p)}
              />
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <button
              onClick={() => { setOpen(false); nav('/projects'); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}
            >
              <Plus size={12} /> Manage Projects
            </button>
          </div>
        )}
      </div>

      {/* delete confirm */}
      {deletingProject && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head"><span className="modal-title">Delete Project</span></div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6 }}>
                Delete <strong style={{ color: 'var(--text)' }}>{deletingProject.name}</strong>?
                All collections, pages, and files will be permanently deleted.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setDeletingProject(null)}>Cancel</button>
              <button className="btn danger" onClick={handleDelete}><Trash2 size={13} /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Backup panel (pinned to sidebar bottom) ───────────────────────────────────
function BackupPanel() {
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ path: string; mb: number } | null>(null);
  const [err, setErr] = useState('');

  const run = async () => {
    if (!dest.trim()) return;
    setLoading(true); setErr(''); setResult(null);
    try {
      const r = await createBackup(dest.trim());
      setResult({ path: r.backup_path, mb: r.size_mb });
    } catch (e: any) {
      setErr(e.message ?? 'Backup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
      <button
        onClick={() => { setOpen(p => !p); setResult(null); setErr(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '10px 14px', background: 'none', border: 'none',
          color: 'var(--text2)', fontSize: 13, fontFamily: 'inherit',
          cursor: 'pointer', textAlign: 'left',
          transition: 'background 0.1s, color 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--text)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text2)'; }}
      >
        <HardDrive size={14} style={{ flexShrink: 0 }} />
        Backup Data
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
            Copies the entire <code style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>data/</code> folder to your chosen location.
          </p>

          <input
            className="modal-input"
            style={{ marginTop: 0, fontSize: 12.5, marginBottom: 8 }}
            placeholder="Destination path e.g. /home/user/backups"
            value={dest}
            onChange={e => setDest(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
          />

          <button
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center', fontSize: 12.5 }}
            onClick={run}
            disabled={loading || !dest.trim()}
          >
            {loading
              ? <><Loader2 size={13} className="spin" /> Backing up…</>
              : <><HardDrive size={13} /> Create Backup</>
            }
          </button>

          {result && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, marginBottom: 2 }}>✓ Backup created</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', wordBreak: 'break-all' }}>{result.path}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{result.mb.toFixed(1)} MB</div>
            </div>
          )}

          {err && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, fontSize: 12, color: '#f87171' }}>
              {err}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
export default function Layout({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const { project } = useProject();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootDocsMap, setRootDocsMap] = useState<Record<string, Document[]>>({});

  // Collection create
  const [showNewCol, setShowNewCol] = useState(false);
  const [newColName, setNewColName] = useState('');

  // Load collections whenever project changes
  useEffect(() => {
    if (!project) return;
    getCollections(project.id).then(setCollections).catch(console.error);
    setExpanded(new Set());
    setRootDocsMap({});
  }, [project]);

  const toggleCollection = useCallback(async (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    if (!rootDocsMap[id]) {
      try {
        const { root_docs } = await getCollection(id);
        setRootDocsMap(prev => ({ ...prev, [id]: root_docs }));
      } catch {}
    }
  }, [rootDocsMap]);

  const addPage = async (collectionId?: string) => {
    if (!project) return;
    try {
      const doc = await createDocument({
        title: 'Untitled',
        collection_id: collectionId,
        project_id: project?.id,
        content: '[]',
      });
      if (collectionId) {
        const { root_docs } = await getCollection(collectionId);
        setRootDocsMap(prev => ({ ...prev, [collectionId]: root_docs }));
        setExpanded(prev => { const s = new Set(prev); s.add(collectionId); return s; });
      }
      nav(`/doc/${doc.id}`);
    } catch {}
  };

  const addCollection = async () => {
    if (!newColName.trim() || !project) return;
    try {
      const col = await createCollection({ name: newColName.trim() }, project.id);
      setCollections(prev => [...prev, col]);
      setNewColName(''); setShowNewCol(false);
    } catch {}
  };

  const active = (path: string) => loc.pathname === path;

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">

        {/* ── PROJECT SWITCHER — compact, at very top ── */}
        <ProjectSwitcher />

        {/* ── APP NAME + SEARCH ── */}
        <div className="sidebar-header">
          <span className="sidebar-logo">KB</span>
          <button className="btn icon-btn" onClick={() => nav('/search')} title="Search"><Search size={15} /></button>
        </div>

        {/* ── NAV + COLLECTIONS ── */}
        <div className="sidebar-scroll">
          <div className="sidebar-section">
            <button className={`sidebar-item ${active('/') ? 'active' : ''}`} onClick={() => nav('/')}>
              <BookOpen size={14} /> Home
            </button>
            <button className={`sidebar-item ${active('/search') ? 'active' : ''}`} onClick={() => nav('/search')}>
              <Search size={14} /> Search
            </button>
            <button className={`sidebar-item ${active('/collections') ? 'active' : ''}`} onClick={() => nav('/collections')}>
              <Layers size={14} /> Collections
            </button>
            <button className={`sidebar-item ${active('/graph') ? 'active' : ''}`} onClick={() => nav('/graph')}>
              <Network size={14} /> Graph
            </button>
            <button className={`sidebar-item ${active('/projects') ? 'active' : ''}`} onClick={() => nav('/projects')}>
              <FolderOpen size={14} /> Projects
            </button>
          </div>

          {/* collections tree for current project */}
          <div className="sidebar-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', marginBottom: 4 }}>
              <span className="sidebar-label" style={{ margin: 0 }}>Collections</span>
              <button className="btn icon-btn" style={{ width: 22, height: 22 }} onClick={() => setShowNewCol(true)} title="New collection">
                <Plus size={13} />
              </button>
            </div>

            {showNewCol && (
              <div style={{ padding: '4px 8px' }}>
                <input className="modal-input" style={{ marginTop: 0, fontSize: 13 }} placeholder="Collection name..."
                  value={newColName} autoFocus
                  onChange={e => setNewColName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCollection(); if (e.key === 'Escape') setShowNewCol(false); }}
                />
              </div>
            )}

            {collections.map(col => (
              <div key={col.id}>
                <div className="col-item" onClick={() => toggleCollection(col.id)}>
                  {expanded.has(col.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="col-name">{col.icon && <>{col.icon} </>}{col.name}</span>
                  <button className="btn icon-btn" style={{ width: 20, height: 20, opacity: 0.6, flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); addPage(col.id); }} title="New page">
                    <Plus size={11} />
                  </button>
                </div>
                {expanded.has(col.id) && (
                  <div style={{ paddingLeft: 8 }}>
                    {(rootDocsMap[col.id] ?? []).length === 0 && (
                      <div style={{ paddingLeft: 22, fontSize: 11.5, color: 'var(--muted)', padding: '3px 10px 3px 28px' }}>No pages yet</div>
                    )}
                    {(rootDocsMap[col.id] ?? []).map(doc => (
                      <DocNode key={doc.id} doc={doc} depth={0} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="sidebar-section" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 16 }}>
            <button className="sidebar-item" onClick={() => addPage()}>
              <Plus size={14} /> New Page
            </button>
          </div>
        </div>

        {/* ── Backup ── */}
        <BackupPanel />
      </aside>

      {/* ── Main ── */}
      <main className="main">{children}</main>

      {/* delete confirm is handled inside ProjectSwitcher */}

      <style>{`
        .doc-child-item:hover .doc-add-btn { opacity: 1 !important; }
        .doc-child-item.active { background: var(--bg3); color: var(--text); }
      `}</style>
    </div>
  );
}
