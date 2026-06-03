import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core';
import { codeBlockOptions } from '@blocknote/code-block';
import { CalloutBlock, CALLOUT_STYLES, type CalloutType } from '../components/editor/CalloutBlock';
import '@blocknote/mantine/style.css';
import {
  ChevronRight, ChevronDown, MoreHorizontal, Trash2, Clock,
  Paperclip, Link2, FileText, Upload, Download,
  Check, Loader2,
} from 'lucide-react';
import type { Document, DocumentDetail, DocumentVersion, Attachment } from '../types';
import {
  getDocument, updateDocument, deleteDocument,
  getDocumentBacklinks, getDocumentAttachments,
  getDocumentVersions, uploadAttachment, getAttachmentUrl,
  createDocument,
} from '../api';
import { useProject } from '../context';

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(ts: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(ts > 1e10 ? ts : ts * 1000)
  );
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function parseBlocks(content: string) {
  try {
    const p = JSON.parse(content);
    if (Array.isArray(p) && p.length > 0) return p;
  } catch {}
  return undefined;
}

// ── Schema with callout + syntax-highlighted code blocks ─────────────────────
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: CalloutBlock,
  },
});

// ── Slash menu callout items ──────────────────────────────────────────────────
function getCalloutMenuItems(editor: typeof schema.BlockNoteEditor) {
  return (Object.keys(CALLOUT_STYLES) as CalloutType[]).map(type => {
    const s = CALLOUT_STYLES[type];
    return {
      title: s.label,
      subtext: `${s.icon} ${s.label} callout`,
      onItemClick: () => {
        const pos = editor.getTextCursorPosition();
        editor.insertBlocks(
          [{ type: 'callout', props: { calloutType: type } }],
          pos.block,
          'after',
        );
      },
      aliases: ['callout', 'note', type],
      group: 'Callouts',
      icon: <span style={{ fontSize: 16 }}>{s.icon}</span>,
    };
  });
}

// ── Keyed editor — remounts on every new doc ──────────────────────────────────
function DocEditor({
  initialContent,
  rawContent,
  onChange,
}: {
  initialContent: any[] | undefined;
  rawContent: string;
  onChange: (content: string) => void;
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent,
    codeBlock: codeBlockOptions,
  });

  // If initialContent is undefined the raw string is Markdown (e.g. written
  // by the MCP server). Convert it to BlockNote blocks after mount.
  useEffect(() => {
    if (initialContent !== undefined) return;
    if (!rawContent || rawContent.trim() === '') return;

    const result = editor.tryParseMarkdownToBlocks(rawContent);
    const apply = (blocks: any[]) => {
      if (blocks.length > 0) editor.replaceBlocks(editor.document, blocks);
    };
    if (result && typeof (result as any).then === 'function') {
      (result as any).then(apply);
    } else {
      apply(result as any);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BlockNoteView
      editor={editor}
      theme="dark"
      onChange={() => onChange(JSON.stringify(editor.document))}
      slashMenu={false}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            [
              ...getDefaultReactSlashMenuItems(editor),
              ...getCalloutMenuItems(editor),
            ],
            query,
          )
        }
      />
    </BlockNoteView>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { project } = useProject();

  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [backlinks, setBacklinks] = useState<Document[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [_editorContent, setEditorContent] = useState('');
  const [initialBlocks, setInitialBlocks] = useState<any[] | undefined>(undefined);
  const [editorKey, setEditorKey] = useState('');

  const [propsOpen, setPropsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showDel, setShowDel] = useState(false);
  const [subPagesOpen, setSubPagesOpen] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const latestContent = useRef('');

  // ── load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setErr('');
    setEditorKey(''); // unmount editor while loading

    Promise.all([
      getDocument(id),
      getDocumentBacklinks(id),
      getDocumentAttachments(id),
    ]).then(([det, bl, att]) => {
      setDetail(det);
      setDoc(det.document);
      setEditTags(det.tags ?? []);
      setTitle(det.document.title);
      setBrief(det.document.brief ?? '');
      setBacklinks(bl);
      setAttachments(att);

      const blocks = parseBlocks(det.document.content);
      setInitialBlocks(blocks);
      setEditorContent(det.document.content);
      latestContent.current = det.document.content;
      setDirty(false);

      // Mount editor after state is set
      setEditorKey(id + '-' + Date.now());
    }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, [id]);

  // ── save ───────────────────────────────────────────────────────────────────
  const save = useCallback(async (contentOverride?: string) => {
    if (!doc) return;
    setSaving(true);
    try {
      const content = contentOverride ?? latestContent.current;
      const updated = await updateDocument(doc.id, {
        title: title.trim() || doc.title,
        content,
        brief: brief || undefined,
        tags: editTags,
      });
      setDoc(updated);
      setDirty(false);
      showToast('Saved');
    } catch (e: any) {
      showToast('Save failed');
    } finally {
      setSaving(false);
    }
  }, [doc, title, brief, editTags]);

  const markDirty = useCallback((content: string) => {
    latestContent.current = content;
    setEditorContent(content);
    setDirty(true);
  }, []);

  // ── tags ───────────────────────────────────────────────────────────────────
  const onTagKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().replace(/,$/, '');
      if (t && !editTags.includes(t)) {
        const next = [...editTags, t];
        setEditTags(next);
        setDirty(true);
      }
      setTagInput('');
    } else if (e.key === 'Backspace' && !tagInput && editTags.length) {
      setEditTags(p => p.slice(0, -1));
      setDirty(true);
    }
  };

  // ── delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!doc) return;
    setDeleting(true);
    try { await deleteDocument(doc.id); nav('/'); }
    catch { showToast('Delete failed'); }
    finally { setDeleting(false); setShowDel(false); }
  };

  // ── attachments ────────────────────────────────────────────────────────────
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !doc) return;
    setUploading(true);
    try {
      for (const f of files) {
        const att = await uploadAttachment(doc.id, f);
        setAttachments(p => [...p, att]);
      }
      showToast(`${files.length} file(s) attached`);
    } catch { showToast('Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  // ── sub-page ───────────────────────────────────────────────────────────────
  const newSubPage = async () => {
    if (!doc) return;
    try {
      const sub = await createDocument({ title: 'Untitled', content: '[]', parent_id: doc.id, project_id: project?.id ?? 'default' });
      nav(`/doc/${sub.id}`);
    } catch { showToast('Failed to create sub-page'); }
  };

  // ── versions ───────────────────────────────────────────────────────────────
  const loadVersions = async () => {
    if (!doc) return;
    setShowVersions(true);
    try { setVersions(await getDocumentVersions(doc.id)); } catch {}
  };

  const restoreVersion = async (v: DocumentVersion) => {
    if (!doc) return;
    await updateDocument(doc.id, { content: v.content, title: v.title });
    setShowVersions(false);
    showToast('Restored — navigating…');
    setTimeout(() => window.location.reload(), 800);
  };

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="center" style={{ flexDirection: 'row', gap: 10 }}>
        <Loader2 size={18} className="spin" />
        <span>Loading…</span>
      </div>
    );
  }
  if (err) {
    return (
      <div className="center" style={{ color: 'var(--danger)' }}>
        <p>{err}</p>
        <button className="btn" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  if (!doc || !detail) return null;

  return (
    <>
      {/* ── topbar ── */}
      <div className="topbar">
        <div className="breadcrumb">
          {detail.breadcrumb.map((b, i) => (
            <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <ChevronRight size={12} />}
              <Link to={`/doc/${b.id}`}>{b.title}</Link>
            </span>
          ))}
          {detail.breadcrumb.length > 0 && <ChevronRight size={12} />}
          <span className="current">{doc.title}</span>
        </div>

        <div className="topbar-right">
          {saving ? (
            <span className="save-badge"><Loader2 size={12} className="spin" /> Saving…</span>
          ) : dirty ? (
            <button className="btn primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => save()}>
              Save
            </button>
          ) : (
            <span className="save-badge"><Check size={12} /> Saved</span>
          )}

          <div style={{ position: 'relative' }}>
            <button className="btn icon-btn" onClick={() => setMenuOpen(p => !p)}>
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 170, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 4, zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                <button className="sidebar-item" onClick={() => { setMenuOpen(false); loadVersions(); }}>
                  <Clock size={13} /> Version history
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <button className="sidebar-item" style={{ color: 'var(--danger)' }} onClick={() => { setMenuOpen(false); setShowDel(true); }}>
                  <Trash2 size={13} /> Delete page
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── body ── */}
      <div className="page-scroll" onClick={() => menuOpen && setMenuOpen(false)}>
        <div className="page-inner">

          {/* title */}
          <input
            className="doc-title"
            value={title}
            placeholder="Untitled"
            onChange={e => { setTitle(e.target.value); setDirty(true); }}
          />

          {/* properties */}
          <button className="props-toggle" onClick={() => setPropsOpen(p => !p)}>
            {propsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Properties
          </button>

          {propsOpen && (
            <div className="props-body">
              <div className="prop-row">
                <span className="prop-label">Tags</span>
                <div className="tags-row">
                  {editTags.map((t, i) => (
                    <span key={i} className="tag">
                      {t}
                      <button onClick={() => { setEditTags(p => p.filter((_, idx) => idx !== i)); setDirty(true); }}>×</button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    placeholder="Add tag…"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={onTagKey}
                  />
                </div>
              </div>
              <div className="prop-row">
                <span className="prop-label">Brief</span>
                <input
                  className="prop-input"
                  placeholder="Short description…"
                  value={brief}
                  onChange={e => { setBrief(e.target.value); setDirty(true); }}
                />
              </div>
              <div className="prop-row">
                <span className="prop-label">Created</span>
                <span className="prop-val">{fmt(doc.created_at)}</span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Updated</span>
                <span className="prop-val">{fmt(doc.updated_at)}</span>
              </div>
            </div>
          )}

          {/* BlockNote editor — keyed so it remounts per doc */}
          {editorKey && (
            <div style={{ marginBottom: 32, marginTop: 8 }}>
              <DocEditor
                key={editorKey}
                initialContent={initialBlocks}
                rawContent={latestContent.current}
                onChange={markDirty}
              />
            </div>
          )}

          {/* sub-pages — collapsible */}
          <div className="section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={() => setSubPagesOpen(p => !p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                  background: 'none', border: 'none', padding: '0 0 10px', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {subPagesOpen
                    ? <ChevronDown size={13} style={{ color: 'var(--muted)' }} />
                    : <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
                  }
                  <FileText size={13} /> Sub-pages
                </span>
                {detail.children.length > 0 && <span className="badge">{detail.children.length}</span>}
              </button>
              <button className="btn" style={{ fontSize: 11, padding: '3px 8px', marginBottom: 10 }} onClick={newSubPage}>+ New</button>
            </div>

            {subPagesOpen && detail.children.length > 0 && (
              <div className="card-list">
                {detail.children.map(c => (
                  <div key={c.id} className="card" onClick={() => nav(`/doc/${c.id}`)}>
                    <FileText size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                    <div className="card-info">
                      <div className="card-title">{c.title}</div>
                      {c.brief && <div className="card-sub">{c.brief}</div>}
                    </div>
                    <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* attachments */}
          <div className="section">
            <div className="section-hdr">
              <div className="section-title">
                <Paperclip size={13} /> Attachments
                {attachments.length > 0 && <span className="badge">{attachments.length}</span>}
              </div>
              <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <><Loader2 size={12} className="spin" /> Uploading…</> : <><Upload size={12} /> Attach</>}
              </button>
            </div>
            <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onFileChange} />
            {attachments.length === 0
              ? <p className="empty">No attachments yet.</p>
              : attachments.map(att => (
                <div key={att.id} className="att-row">
                  <Paperclip size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  <div className="att-info">
                    <div className="att-name">{att.filename}</div>
                    <div className="att-meta">{fmtSize(att.size)} · {fmt(att.created_at)}</div>
                  </div>
                  <a href={getAttachmentUrl(att.id)} target="_blank" rel="noopener noreferrer" className="btn icon-btn" title="Download">
                    <Download size={13} />
                  </a>
                </div>
              ))
            }
          </div>

          {/* backlinks */}
          {backlinks.length > 0 && (
            <div className="section">
              <div className="section-title">
                <Link2 size={13} /> Backlinks <span className="badge">{backlinks.length}</span>
              </div>
              <div className="card-list">
                {backlinks.map(b => (
                  <div key={b.id} className="card" onClick={() => nav(`/doc/${b.id}`)}>
                    <Link2 size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                    <div className="card-info">
                      <div className="card-title">{b.title}</div>
                      {b.brief && <div className="card-sub">{b.brief}</div>}
                    </div>
                    <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* version history */}
      {showVersions && (
        <div className="modal-overlay" onClick={() => setShowVersions(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">Version History</span>
              <button className="btn icon-btn" onClick={() => setShowVersions(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {versions.length === 0
                ? <p className="empty">No saved versions yet.</p>
                : versions.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>v{v.version_number} — {v.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmt(v.created_at)}</div>
                    </div>
                    <button className="btn" style={{ fontSize: 12 }} onClick={() => restoreVersion(v)}>Restore</button>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* delete confirm */}
      {showDel && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <span className="modal-title">Delete Page</span>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6 }}>
                Delete <strong style={{ color: 'var(--text)' }}>{doc.title}</strong>? This cannot be undone.
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
