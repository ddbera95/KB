import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, Plus, ChevronRight, ChevronDown, ChevronLeft,
  FileText, Network, Layers, BookOpen,
  MoreHorizontal, Trash2, Edit2, FolderOpen,
  HardDrive, Loader2, FolderPlus, Settings, Sun, Moon,
} from 'lucide-react';
import type { Collection, Document, Project } from '../types';
import {
  getCollections, getCollection, getDocumentChildren, listDocuments,
  createDocument, createCollection,
  deleteProject, updateProject, createBackup, browseDir, mkdirBackup,
  getSettings, saveSettings, type AppSettings,
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
          <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 2, width: 148, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7, padding: 4, zIndex: 9999, boxShadow: '0 -8px 24px rgba(0,0,0,.6)' }}>
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
            position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 500,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderBottom: 'none', boxShadow: '0 -8px 28px rgba(0,0,0,.5)',
            borderRadius: '8px 8px 0 0', paddingTop: 4,
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

// ── Theme hook ───────────────────────────────────────────────────────────────
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

// ── Directory picker modal ────────────────────────────────────────────────────
function DirPicker({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  const navigate = async (path?: string) => {
    setLoading(true); setErr(''); setNewFolderMode(false);
    try {
      const r = await browseDir(path);
      setCurrent(r.current);
      setParent(r.parent ?? null);
      setEntries(r.entries.filter(e => e.is_dir));
    } catch (e: any) {
      setErr(e.message ?? 'Cannot open directory');
    } finally {
      setLoading(false);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true); setCreateErr('');
    try {
      const r = await mkdirBackup(current, newFolderName.trim());
      await navigate(r.path); // navigate into the new folder
      setNewFolderName('');
    } catch (e: any) {
      setCreateErr(e.message ?? 'Failed to create folder');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => { navigate(); }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Select Backup Destination</span>
          <button className="btn icon-btn" onClick={onClose}>✕</button>
        </div>

        {/* Current path bar */}
        <div style={{ padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
          {current || '…'}
        </div>

        {/* Directory list */}
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}><Loader2 size={18} className="spin" /></div>}
          {err && <div style={{ padding: '12px 20px', color: 'var(--danger)', fontSize: 13 }}>{err}</div>}

          {!loading && !err && (
            <>
              {parent !== null && (
                <button
                  onClick={() => navigate(parent)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text2)', fontSize: 13, fontFamily: 'inherit', borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 16 }}>↑</span> .. (go up)
                </button>
              )}

              {entries.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No subdirectories</div>
              )}

              {entries.map(e => (
                <button
                  key={e.path}
                  onClick={() => navigate(e.path)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}
                  onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={el => (el.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 16 }}>📁</span>
                  {e.name}
                </button>
              ))}
            </>
          )}
        </div>

        {/* New folder input */}
        {newFolderMode && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 16 }}>📁</span>
              <input
                autoFocus
                className="modal-input"
                style={{ flex: 1, marginTop: 0, fontSize: 13 }}
                placeholder="New folder name…"
                value={newFolderName}
                onChange={e => { setNewFolderName(e.target.value); setCreateErr(''); }}
                onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setNewFolderMode(false); setNewFolderName(''); } }}
              />
              <button className="btn primary" style={{ fontSize: 12, padding: '4px 10px', flexShrink: 0 }} onClick={createFolder} disabled={creating || !newFolderName.trim()}>
                {creating ? <Loader2 size={12} className="spin" /> : 'Create'}
              </button>
              <button className="btn" style={{ fontSize: 12, padding: '4px 8px', flexShrink: 0 }} onClick={() => { setNewFolderMode(false); setNewFolderName(''); }}>✕</button>
            </div>
            {createErr && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{createErr}</div>}
          </div>
        )}

        <div className="modal-foot space-between">
          {/* New folder button on the left */}
          <button
            className="btn"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            onClick={() => { setNewFolderMode(p => !p); setNewFolderName(''); setCreateErr(''); }}
            disabled={!current}
          >
            <FolderPlus size={13} /> New Folder
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={!current}
              onClick={() => { onSelect(current); onClose(); }}
            >
              Select "{current.split('/').pop() || current}"
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings panel (pinned to sidebar bottom) ─────────────────────────────────
function SettingsPanel() {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({});
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [showAutoPicker, setShowAutoPicker] = useState(false);
  const [backing, setBacking] = useState(false);
  const [result, setResult] = useState<{ path: string; mb: number } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) getSettings().then(setSettings).catch(() => {});
  }, [open]);

  const save = async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    try { await saveSettings(next); } catch {}
  };

  const runManualBackup = async () => {
    if (!settings.manual_backup_dir?.trim()) return;
    setBacking(true); setErr(''); setResult(null);
    try {
      const r = await createBackup(settings.manual_backup_dir);
      setResult({ path: r.backup_path, mb: r.size_mb });
    } catch (e: any) { setErr(e.message ?? 'Backup failed'); }
    finally { setBacking(false); }
  };

  const hours = Array.from({ length: 24 }, (_, i) => {
    const h = i % 12 || 12;
    const ampm = i < 12 ? 'AM' : 'PM';
    return { value: i, label: `${h}:00 ${ampm}` };
  });

  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={() => { setOpen(p => !p); setResult(null); setErr(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text2)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', transition: 'background 0.1s, color 0.1s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text2)'; }}
        >
          <Settings size={14} style={{ flexShrink: 0 }} />
          Settings
        </button>

        {open && (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Appearance */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Appearance</div>
              <button
                onClick={toggle}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                {theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              </button>
            </div>

            {/* Manual Backup */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Manual Backup</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <div onClick={() => setShowManualPicker(true)} style={{ flex: 1, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: settings.manual_backup_dir ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {settings.manual_backup_dir || 'Click to choose folder…'}
                </div>
                <button className="btn" style={{ fontSize: 12, padding: '4px 8px', flexShrink: 0 }} onClick={() => setShowManualPicker(true)}>Browse</button>
              </div>
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center', fontSize: 12.5 }} onClick={runManualBackup} disabled={backing || !settings.manual_backup_dir?.trim()}>
                {backing ? <><Loader2 size={13} className="spin" /> Backing up…</> : <><HardDrive size={13} /> Backup Now</>}
              </button>
              {result && <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 6 }}><div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Done — {result.mb.toFixed(1)} MB</div><div style={{ fontSize: 11, color: 'var(--text2)', wordBreak: 'break-all' }}>{result.path}</div></div>}
              {err && <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            </div>

            {/* Auto Backup */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Auto Backup</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <div onClick={() => setShowAutoPicker(true)} style={{ flex: 1, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: settings.auto_backup_dir ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {settings.auto_backup_dir || 'Click to choose folder…'}
                </div>
                <button className="btn" style={{ fontSize: 12, padding: '4px 8px', flexShrink: 0 }} onClick={() => setShowAutoPicker(true)}>Browse</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings.auto_backup_hour != null} onChange={e => save({ auto_backup_hour: e.target.checked ? 2 : null })} />
                  Enable at
                </label>
                <select
                  value={settings.auto_backup_hour ?? 2}
                  onChange={e => save({ auto_backup_hour: parseInt(e.target.value) })}
                  disabled={settings.auto_backup_hour == null}
                  style={{ flex: 1, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                >
                  {hours.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>Keeps one rolling backup — replaces previous on each run.</div>
            </div>
          </div>
        )}
      </div>

      {showManualPicker && <DirPicker onSelect={path => { save({ manual_backup_dir: path }); setShowManualPicker(false); }} onClose={() => setShowManualPicker(false)} />}
      {showAutoPicker && <DirPicker onSelect={path => { save({ auto_backup_dir: path }); setShowAutoPicker(false); }} onClose={() => setShowAutoPicker(false)} />}
    </>
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
          <button className="btn icon-btn" onClick={() => nav('/search')} title="Search">
            <Search size={15} />
          </button>
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
        </div>

        {/* ── PROJECT SWITCHER — above backup at bottom ── */}
        <ProjectSwitcher />

        {/* ── Settings ── */}
        <SettingsPanel />
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
