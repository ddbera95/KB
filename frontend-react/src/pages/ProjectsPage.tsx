import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Check } from 'lucide-react';
import type { Project } from '../types';
import { getProjects, createProject, deleteProject } from '../api';
import { useProject } from '../context';

const PRESET_COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#3b82f6', label: 'Blue' },
];

export default function ProjectsPage() {
  const { project: current, setProject, refreshProjects } = useProject();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0].value);
  const [creating, setCreating] = useState(false);

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch(e => showToast(e.message ?? 'Failed to load projects'))
      .finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setNewName('');
    setNewDesc('');
    setNewColor(PRESET_COLORS[0].value);
    setShowNew(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const p = await createProject({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        color: newColor,
      });
      await refreshProjects();
      setProject(p);
      const updated = await getProjects();
      setProjects(updated);
      setShowNew(false);
      showToast(`Project "${p.name}" created`);
    } catch (e: any) {
      showToast(e.message ?? 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      await refreshProjects();
      const updated = await getProjects();
      setProjects(updated);
      setDeleteTarget(null);
      showToast('Project deleted');
    } catch (e: any) {
      showToast(e.message ?? 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="center">
        <Loader2 size={22} className="spin" />
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <div className="home-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 className="home-title" style={{ marginBottom: 4 }}>Projects</h1>
            <p className="home-sub" style={{ marginBottom: 0 }}>
              Separate workspaces — each project has its own collections, pages and attachments.
            </p>
          </div>
          <button className="btn primary" onClick={openCreate}>
            <Plus size={14} /> New Project
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="center" style={{ paddingTop: 60 }}>
            <p>No projects yet.</p>
          </div>
        ) : (
          <div className="home-grid">
            {projects.map(proj => {
              const isActive = current?.id === proj.id;
              return (
                <div
                  key={proj.id}
                  className="home-card"
                  onClick={() => setProject(proj)}
                  style={{
                    borderColor: isActive ? proj.color : undefined,
                    borderWidth: isActive ? 2 : 1,
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      {/* Colour swatch */}
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          backgroundColor: proj.color,
                          flexShrink: 0,
                        }}
                      />
                      <div
                        className="home-card-title"
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {proj.name}
                      </div>
                      {isActive && (
                        <span
                          style={{
                            fontSize: 10, fontWeight: 600, padding: '1px 7px',
                            background: proj.color, color: '#fff', borderRadius: 20,
                            flexShrink: 0,
                          }}
                        >
                          Active
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {isActive && <Check size={14} style={{ color: proj.color }} />}
                      <button
                        className="btn icon-btn"
                        style={{ color: 'var(--danger)', padding: '2px' }}
                        onClick={e => { e.stopPropagation(); setDeleteTarget(proj); }}
                        title="Delete project"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {proj.description && (
                    <div className="home-card-sub" style={{ marginTop: 6, paddingLeft: 24 }}>
                      {proj.description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">New Project</span>
              <button className="btn icon-btn" onClick={() => setShowNew(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="modal-label">Name *</label>
                <input
                  autoFocus
                  className="modal-input"
                  placeholder="My Project"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div>
                <label className="modal-label">Description (optional)</label>
                <input
                  className="modal-input"
                  placeholder="What is this project for?"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="modal-label" style={{ display: 'block', marginBottom: 8 }}>Colour</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c.value}
                      title={c.label}
                      onClick={() => setNewColor(c.value)}
                      style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: c.value,
                        border: newColor === c.value ? '3px solid #fff' : '3px solid transparent',
                        cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {newColor === c.value && <Check size={14} color="#fff" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className="btn primary"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
              >
                {creating ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Create Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">Delete Project</span>
              <button className="btn icon-btn" onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.7 }}>
                Permanently delete{' '}
                <strong style={{ color: 'var(--text)' }}>{deleteTarget.name}</strong>?<br />
                All collections, pages, and files in this project will be deleted and cannot be recovered.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className="btn danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Delete Everything
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
