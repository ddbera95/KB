import { useState, useEffect, useCallback } from 'react';
import {
  Settings, HardDrive, Loader2, ChevronDown,
  Key, Plus, Trash2, Copy, Check, FolderPlus,
} from 'lucide-react';
import { useAuth } from '../context';
import { useProject } from '../context';
import {
  getSettings, saveSettings, type AppSettings,
  createBackup, browseDir, mkdirBackup,
  getUsers, createUser, deleteUser,
  getApiKeys, createApiKey, deleteApiKey,
  changePassword,
} from '../api';

// ── Clipboard helper (works on HTTP, not just HTTPS) ─────────────────────────
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
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
      await navigate(r.path);
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
        <div style={{ padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
          {current || '…'}
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}><Loader2 size={18} className="spin" /></div>}
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
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No subdirectories</div>
              )}
              {entries.map(e => (
                <button
                  key={e.path}
                  onClick={() => navigate(e.path)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}
                  onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={el => (el.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 16 }}>📁</span>{e.name}
                </button>
              ))}
            </>
          )}
        </div>
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
          <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }} onClick={() => { setNewFolderMode(p => !p); setNewFolderName(''); setCreateErr(''); }} disabled={!current}>
            <FolderPlus size={13} /> New Folder
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!current} onClick={() => { onSelect(current); onClose(); }}>
              Select "{current.split('/').pop() || current}"
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
      {label}
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px 28px', ...style }}>
      {children}
    </div>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────
function GeneralTab() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [showAutoPicker, setShowAutoPicker] = useState(false);
  const [backing, setBacking] = useState(false);
  const [result, setResult] = useState<{ path: string; mb: number } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Manual Backup */}
      <Card>
        <SectionHead label="Manual Backup" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div
            onClick={() => setShowManualPicker(true)}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, color: settings.manual_backup_dir ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {settings.manual_backup_dir || 'Click to choose destination folder…'}
          </div>
          <button className="btn" onClick={() => setShowManualPicker(true)}>Browse</button>
        </div>
        <button
          className="btn primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          onClick={runManualBackup}
          disabled={backing || !settings.manual_backup_dir?.trim()}
        >
          {backing ? <><Loader2 size={14} className="spin" /> Backing up…</> : <><HardDrive size={14} /> Backup Now</>}
        </button>
        {result && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 7 }}>
            <div style={{ fontSize: 13, color: '#4ade80', fontWeight: 600 }}>Done — {result.mb.toFixed(1)} MB</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', wordBreak: 'break-all', marginTop: 2 }}>{result.path}</div>
          </div>
        )}
        {err && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 7, fontSize: 13, color: 'var(--danger)' }}>{err}</div>
        )}
      </Card>

      {/* Auto Backup */}
      <Card>
        <SectionHead label="Auto Backup" />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div
            onClick={() => setShowAutoPicker(true)}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, color: settings.auto_backup_dir ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {settings.auto_backup_dir || 'Click to choose destination folder…'}
          </div>
          <button className="btn" onClick={() => setShowAutoPicker(true)}>Browse</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.auto_backup_hour != null} onChange={e => save({ auto_backup_hour: e.target.checked ? 2 : null })} />
            Enable at
          </label>
          <select
            value={settings.auto_backup_hour ?? 2}
            onChange={e => save({ auto_backup_hour: parseInt(e.target.value) })}
            disabled={settings.auto_backup_hour == null}
            style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          >
            {hours.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Keeps one rolling backup — replaces previous on each run.</div>
      </Card>

      {showManualPicker && <DirPicker onSelect={path => { save({ manual_backup_dir: path }); setShowManualPicker(false); }} onClose={() => setShowManualPicker(false)} />}
      {showAutoPicker && <DirPicker onSelect={path => { save({ auto_backup_dir: path }); setShowAutoPicker(false); }} onClose={() => setShowAutoPicker(false)} />}
    </div>
  );
}

// ── Password tab ──────────────────────────────────────────────────────────────
function PasswordTab() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!currentPw || !newPw) return;
    setSaving(true); setMsg(''); setErr('');
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw(''); setNewPw('');
      setMsg('Password changed successfully.');
    } catch (e: any) {
      setErr(e.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionHead label="Change Password" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="password"
          className="modal-input"
          style={{ marginTop: 0, fontSize: 14, padding: '8px 12px' }}
          placeholder="Current password"
          value={currentPw}
          onChange={e => setCurrentPw(e.target.value)}
        />
        <input
          type="password"
          className="modal-input"
          style={{ marginTop: 0, fontSize: 14, padding: '8px 12px' }}
          placeholder="New password"
          value={newPw}
          onChange={e => setNewPw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
        />
        <button
          className="btn primary"
          style={{ alignSelf: 'flex-start' }}
          onClick={handleSave}
          disabled={saving || !currentPw || !newPw}
        >
          {saving ? <Loader2 size={14} className="spin" /> : 'Change Password'}
        </button>
        {msg && <div style={{ fontSize: 13, color: '#4ade80' }}>{msg}</div>}
        {err && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{err}</div>}
      </div>
    </Card>
  );
}

// ── Users tab (admin only) ────────────────────────────────────────────────────
interface UserRow { id: string; username: string; is_admin: boolean; created_at: number }

function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await getUsers() as UserRow[];
      setUsers(list);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreating(true); setErr('');
    try {
      await createUser(newUsername.trim(), newPassword.trim());
      setNewUsername(''); setNewPassword('');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try { await deleteUser(id); await load(); } catch (e: any) { setErr(e.message ?? 'Failed'); }
  };

  if (loading) return <div style={{ fontSize: 14, color: 'var(--muted)' }}>Loading users…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* User list */}
      <Card>
        <SectionHead label="Users" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {users.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--text2)', flexShrink: 0 }}>
                {u.username[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.username}
                  {u.id === me?.user_id && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>(you)</span>}
                </div>
                {u.is_admin && <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Admin</div>}
              </div>
              {u.id !== me?.user_id && (
                <button
                  onClick={() => handleDelete(u.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', padding: '4px' }}
                  title="Delete user"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {users.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No users found.</div>}
        </div>
      </Card>

      {/* Create user */}
      <Card>
        <SectionHead label="Add User" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="modal-input"
            style={{ marginTop: 0, fontSize: 14, padding: '8px 12px' }}
            placeholder="Username"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
          />
          <input
            type="password"
            className="modal-input"
            style={{ marginTop: 0, fontSize: 14, padding: '8px 12px' }}
            placeholder="Password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button
            className="btn primary"
            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleCreate}
            disabled={creating || !newUsername.trim() || !newPassword.trim()}
          >
            {creating ? <Loader2 size={14} className="spin" /> : <><Plus size={14} /> Add User</>}
          </button>
          {err && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{err}</div>}
        </div>
      </Card>
    </div>
  );
}

// ── API Keys tab (admin only) ─────────────────────────────────────────────────
interface ApiKeyRow {
  id: string; name: string; key_value: string;
  project_id: string; created_by: string; created_at: number; last_used_at?: number;
}

function ProjectKeySection({
  project, keys, onDelete, onAdd, copiedId, onCopy,
}: {
  project: { id: string; name: string; color: string };
  keys: ApiKeyRow[];
  onDelete: (id: string) => void;
  onAdd: (projectId: string, name: string) => Promise<void>;
  copiedId: string | null;
  onCopy: (key: ApiKeyRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [projIdCopied, setProjIdCopied] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setCreating(true); setErr('');
    try {
      await onAdd(project.id, newName.trim());
      setNewName(''); setAdding(false);
    } catch (e: any) {
      setErr(e.message ?? 'Failed');
    } finally {
      setCreating(false);
    }
  };

  const copyProjectId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await copyText(project.id);
      setProjIdCopied(true);
      setTimeout(() => setProjIdCopied(false), 1500);
    } catch {}
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Project header row — click to expand */}
      <div
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '13px 18px', background: open ? 'var(--bg3)' : 'var(--bg2)',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{project.name}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
          {project.id}
        </span>
        <button
          onClick={copyProjectId}
          title="Copy project ID"
          style={{ background: 'none', border: 'none', color: projIdCopied ? '#4ade80' : 'var(--muted)', cursor: 'pointer', display: 'flex', padding: '3px 5px', borderRadius: 4, flexShrink: 0 }}
        >
          {projIdCopied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 6 }}>
          {keys.length} {keys.length === 1 ? 'key' : 'keys'}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </div>

      {open && (
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg)' }}>
          {/* Key list */}
          {keys.length === 0 && !adding && (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0' }}>No API keys for this project.</div>
          )}
          {keys.map(k => (
            <div key={k.id} style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <Key size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name}</span>
                <button
                  onClick={() => onCopy(k)}
                  title="Copy key"
                  style={{ background: 'none', border: 'none', color: copiedId === k.id ? '#4ade80' : 'var(--muted)', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 4, flexShrink: 0 }}
                >
                  {copiedId === k.id ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <button
                  onClick={() => onDelete(k.id)}
                  title="Delete key"
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 4, flexShrink: 0 }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: k.last_used_at ? 4 : 0 }}>
                {k.key_value}
              </div>
              {k.last_used_at && (
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  Last used: {new Date(k.last_used_at * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}

          {/* Inline add form */}
          {adding ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  autoFocus
                  className="modal-input"
                  style={{ flex: 1, marginTop: 0, fontSize: 13, padding: '7px 10px' }}
                  placeholder="Key name (e.g. MCP prod)"
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setErr(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
                />
                <button
                  className="btn primary"
                  style={{ fontSize: 13, padding: '7px 14px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={handleAdd}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? <Loader2 size={13} className="spin" /> : <><Key size={13} /> Create</>}
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 13, padding: '7px 10px', flexShrink: 0 }}
                  onClick={() => { setAdding(false); setNewName(''); setErr(''); }}
                >
                  Cancel
                </button>
              </div>
              {err && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>}
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'none', border: '1px dashed var(--border)', borderRadius: 7, color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' }}
            >
              <Plus size={13} /> Add API Key
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ApiKeysTab() {
  const { projects } = useProject();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getApiKeys() as ApiKeyRow[];
      setKeys(list);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    try { await deleteApiKey(id); await load(); } catch {}
  };

  const handleAdd = async (projectId: string, name: string) => {
    await createApiKey(name, projectId);
    await load();
  };

  const handleCopy = async (key: ApiKeyRow) => {
    try {
      await copyText(key.key_value);
      setCopiedId(key.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  if (loading) return <div style={{ fontSize: 14, color: 'var(--muted)' }}>Loading keys…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
        Click a project to view and manage its API keys.
      </div>
      {projects.map(p => (
        <ProjectKeySection
          key={p.id}
          project={p}
          keys={keys.filter(k => k.project_id === p.id)}
          onDelete={handleDelete}
          onAdd={handleAdd}
          copiedId={copiedId}
          onCopy={handleCopy}
        />
      ))}
      {projects.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>No projects found. Create a project first.</div>
      )}
    </div>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────────
type Tab = 'general' | 'password' | 'users' | 'apikeys';

const TAB_LABELS: Record<Tab, string> = {
  general: 'General',
  password: 'Password',
  users: 'Users',
  apikeys: 'API Keys',
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const tabs: Tab[] = [
    'general',
    'password',
    ...(user?.is_admin ? (['users', 'apikeys'] as Tab[]) : []),
  ];

  return (
    /* Scrollable full-height wrapper — fills .main which is overflow:hidden */
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '40px 56px 80px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <Settings size={22} style={{ color: 'var(--text2)' }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Settings</h1>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 32 }}>
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              style={{
                padding: '9px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === t ? 'var(--text)' : 'var(--text2)',
                fontSize: 14,
                fontWeight: activeTab === t ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color 0.1s',
                marginBottom: -1,
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'password' && <PasswordTab />}
        {activeTab === 'users' && user?.is_admin && <UsersTab />}
        {activeTab === 'apikeys' && user?.is_admin && <ApiKeysTab />}
      </div>
    </div>
  );
}
