import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, Plus, ChevronRight, ChevronDown, ChevronLeft,
  FileText, Network, Layers, BookOpen,
  MoreHorizontal, Trash2, Edit2, FolderOpen,
  Settings, LogOut, Copy, Check, Sun, Moon,
} from 'lucide-react';
import type { Collection, Document, Project } from '../types';
import {
  getCollections, getCollection, getDocumentChildren, listDocuments,
  createDocument, createCollection,
  deleteProject, updateProject,
} from '../api';
import { useProject } from '../context';
import { useAuth } from '../context';

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
          <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 2, width: 148, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7, padding: 4, zIndex: 9999, boxShadow: '0 -8px 24px rgba(0,0,0,.6)' }}>
            <button className="sidebar-item" style={{ gap: 8, fontSize: 12.5 }} onClick={() => { setEditing(true); setMenuOpen(false); }}>
              <Edit2 size={12} /> Rename
            </button>
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
              <button className="sidebar-item" style={{ gap: 8, fontSize: 12.5, color: 'var(--danger)' }} onClick={() => { onDelete(); setMenuOpen(false); }}>
                <Trash2 size={12} /> Delete
              </button>
            </>
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
  const [copied, setCopied] = useState(false);
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

  const copyProjectId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!project) return;
    try {
      await navigator.clipboard.writeText(project.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
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

        {/* Project ID display (always visible below trigger) */}
        {project && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={project.id}>
              ID: {project.id}
            </span>
            <button
              onClick={copyProjectId}
              title="Copy project ID"
              style={{ background: 'none', border: 'none', padding: '1px 3px', color: copied ? '#4ade80' : 'var(--muted)', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
            </button>
          </div>
        )}

        {/* ── dropdown: all projects + options ── */}
        {open && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 500,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderBottom: 'none', boxShadow: '0 -8px 28px rgba(0,0,0,.5)',
            borderRadius: '8px 8px 0 0', paddingTop: 4,
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

// ── Theme hook ────────────────────────────────────────────────────────────────
function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('mimix-theme') as 'dark' | 'light') ?? 'dark'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mimix-theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => t === 'dark' ? 'light' : 'dark') };
}

// ── Sidebar bottom user bar ───────────────────────────────────────────────────
function UserBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();
  const isSettings = loc.pathname === '/settings';

  return (
    <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.username}
          {user?.is_admin && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>admin</span>}
        </div>
      </div>
      <button
        onClick={() => nav('/settings')}
        title="Settings"
        style={{ background: isSettings ? 'var(--bg3)' : 'none', border: 'none', padding: '4px', color: isSettings ? 'var(--text)' : 'var(--text2)', cursor: 'pointer', display: 'flex', borderRadius: 5 }}
      >
        <Settings size={15} />
      </button>
      <button
        onClick={logout}
        title="Sign out"
        style={{ background: 'none', border: 'none', padding: '4px', color: 'var(--text2)', cursor: 'pointer', display: 'flex', borderRadius: 5 }}
      >
        <LogOut size={15} />
      </button>
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

  // Standalone pages (no collection)
  const [pages, setPages] = useState<Document[]>([]);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [pagesPage, setPagesPage] = useState(1);
  const PAGES_PER_PAGE = 15;

  // Collection create
  const [showNewCol, setShowNewCol] = useState(false);
  const [newColName, setNewColName] = useState('');

  // Load collections whenever project changes
  useEffect(() => {
    if (!project) return;
    getCollections(project.id).then(setCollections).catch(console.error);
    setExpanded(new Set());
    setRootDocsMap({});
    setPagesPage(1);
  }, [project]);

  // Load standalone pages (no collection) with pagination
  useEffect(() => {
    if (!project) return;
    listDocuments({
      project_id: project.id,
      standalone: 'true',
      page: String(pagesPage),
      per_page: String(PAGES_PER_PAGE),
    }).then(res => {
      setPages(res.data);
      setPagesTotal(res.total);
    }).catch(console.error);
  }, [project, pagesPage]);

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
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">

        {/* ── MIMIX LOGO — top of sidebar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <img src="/mimix-logo.svg" alt="Mimix" style={{ height: 28, width: 'auto' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="btn icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="btn icon-btn" onClick={() => nav('/search')} title="Search">
              <Search size={15} />
            </button>
          </div>
        </div>

        {/* ── NAV + COLLECTIONS (scrollable middle) ── */}
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

          {/* No project empty state */}
          {!project && (
            <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <FolderOpen size={28} style={{ color: 'var(--muted)' }} />
              <div style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
                No project selected.<br />Create one to get started.
              </div>
              <button
                className="btn primary"
                style={{ fontSize: 12, marginTop: 4 }}
                onClick={() => nav('/projects')}
              >
                <Plus size={12} /> Create Project
              </button>
            </div>
          )}

          {/* collections tree + pages for current project */}
          {project && <><div className="sidebar-section">
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

          {/* ── Standalone Pages ── */}
          <div className="sidebar-section" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', marginBottom: 4 }}>
              <span className="sidebar-label" style={{ margin: 0 }}>Pages</span>
              <button className="btn icon-btn" style={{ width: 22, height: 22 }} onClick={() => addPage()} title="New page">
                <Plus size={13} />
              </button>
            </div>

            {pages.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '3px 10px' }}>No standalone pages</div>
            )}

            {pages.map(doc => (
              <button
                key={doc.id}
                className={`sidebar-item ${loc.pathname === `/doc/${doc.id}` ? 'active' : ''}`}
                style={{ paddingLeft: 14, fontSize: 13 }}
                onClick={() => nav(`/doc/${doc.id}`)}
                title={doc.title}
              >
                <FileText size={13} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.title}
                </span>
              </button>
            ))}

            {/* Pagination */}
            {pagesTotal > PAGES_PER_PAGE && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '6px 0', marginTop: 4 }}>
                <button
                  className="btn icon-btn" style={{ width: 22, height: 22 }}
                  disabled={pagesPage === 1}
                  onClick={() => setPagesPage(p => p - 1)}
                >
                  <ChevronLeft size={13} />
                </button>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {pagesPage} / {Math.ceil(pagesTotal / PAGES_PER_PAGE)}
                </span>
                <button
                  className="btn icon-btn" style={{ width: 22, height: 22 }}
                  disabled={pagesPage >= Math.ceil(pagesTotal / PAGES_PER_PAGE)}
                  onClick={() => setPagesPage(p => p + 1)}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
          </>}
        </div>

        {/* ── PROJECT SWITCHER — above backup at bottom ── */}
        <ProjectSwitcher />

        {/* ── User bar + Settings icon ── */}
        <UserBar />
      </aside>

      {/* ── Main ── */}
      <main className="main">{children}</main>

      <style>{`
        .doc-child-item:hover .doc-add-btn { opacity: 1 !important; }
        .doc-child-item.active { background: var(--bg3); color: var(--text); }
      `}</style>
    </div>
  );
}
