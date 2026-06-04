import { useEffect, useState, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { filterSuggestionItems, BlockNoteSchema, defaultBlockSpecs, createCodeBlockSpec } from '@blocknote/core';
import { codeBlockOptions } from '@blocknote/code-block';
import '@blocknote/mantine/style.css';
import { loadDictionary, checkText, getSuggestions, type SpellError } from '../components/editor/SpellCheck';
import {
  ChevronRight, ChevronDown, MoreHorizontal, Trash2, Clock,
  Paperclip, Link2, FileText, Upload, Download,
  Check, Loader2, SpellCheck,
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
// Derived at runtime from the actual schema — always in sync, never stale

// Convert [[Page Title]] wiki links to standard Markdown links so BlockNote
// renders them as clickable links. Clicking navigates to /search?q=title
// which finds the target page via full-text search.
function wikiLinksToMarkdown(md: string): string {
  return md.replace(/\[\[([^\]]+)\]\]/g, (_, title) =>
    `[${title}](/search?q=${encodeURIComponent(title)})`
  );
}

// Walk BlockNote JSON blocks and expand [[wiki links]] inside text nodes
// into actual link inline content so they render as clickable links.
function expandWikiLinksInBlocks(blocks: any[]): any[] {
  return blocks.map(block => ({
    ...block,
    content: expandInlineContent(block.content),
    children: block.children?.length ? expandWikiLinksInBlocks(block.children) : block.children,
  }));
}

function expandInlineContent(content: any): any {
  if (!Array.isArray(content)) return content;
  const result: any[] = [];
  for (const node of content) {
    if (node.type !== 'text' || !node.text?.includes('[[')) {
      result.push(node);
      continue;
    }
    // Split on [[...]] and rebuild as text + link nodes
    const parts = node.text.split(/(\[\[[^\]]+\]\])/g);
    for (const part of parts) {
      const m = part.match(/^\[\[(.+)\]\]$/);
      if (m) {
        result.push({
          type: 'link',
          href: `/search?q=${encodeURIComponent(m[1])}`,
          content: [{ type: 'text', text: m[1], styles: {} }],
        });
      } else if (part) {
        result.push({ type: 'text', text: part, styles: node.styles ?? {} });
      }
    }
  }
  return result;
}

function parseBlocks(content: string) {
  try {
    const p = JSON.parse(content);
    if (!Array.isArray(p) || p.length === 0) return undefined;
    // Filter to only block types actually in the current schema
    const safe = p
      .filter((b: any) => b?.type && KNOWN_BLOCK_TYPES.has(b.type))
      .map((b: any) => ({
        // Only keep known props to avoid crashes from stale prop schemas
        type: b.type,
        props: b.props ?? {},
        content: b.content ?? [],
        children: (b.children ?? []).filter((c: any) => c?.type && KNOWN_BLOCK_TYPES.has(c.type)),
      }));
    if (safe.length === 0) return undefined;
    // Expand [[wiki links]] in JSON blocks to proper link nodes
    return expandWikiLinksInBlocks(safe);
  } catch {}
  return undefined;
}

// ── Schema: replace plain codeBlock with Shiki-powered one ──────────────────
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
});

// Derive valid block types from the actual schema — never stale
const KNOWN_BLOCK_TYPES = new Set(Object.keys(schema.blockSpecs));

// ── Callout templates — inserted as styled paragraphs via the slash menu ───────
const CALLOUT_ITEMS = [
  { title: 'Info Note',  emoji: 'ℹ️',  color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  aliases: ['info','note','callout'] },
  { title: 'Warning',    emoji: '⚠️',  color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', aliases: ['warning','caution','callout'] },
  { title: 'Tip',        emoji: '💡',  color: '#10b981', bg: 'rgba(16,185,129,0.08)', aliases: ['tip','hint','callout'] },
  { title: 'Danger',     emoji: '🚨',  color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  aliases: ['danger','error','callout'] },
  { title: 'Note',       emoji: '📝',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', aliases: ['note','comment','callout'] },
] as const;

function getCalloutMenuItems(editor: any) {
  return CALLOUT_ITEMS.map(item => ({
    title: item.title,
    subtext: `${item.emoji} ${item.title} callout block`,
    aliases: item.aliases as unknown as string[],
    group: 'Callouts',
    icon: <span style={{ fontSize: 16 }}>{item.emoji}</span>,
    onItemClick: () => {
      const ref = editor.getTextCursorPosition()?.block ?? editor.document[0];
      if (!ref) return;
      editor.insertBlocks(
        [{
          type: 'paragraph',
          content: [{ type: 'text', text: `${item.emoji}  `, styles: {} }],
          props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        }],
        ref,
        'after',
      );
      // Style the inserted block's DOM element via a one-shot MutationObserver
      // since BlockNote doesn't expose per-block CSS via its API.
    },
  }));
}

// ── Dynamic theme hook — tracks data-theme attribute on <html> ────────────────
function useCurrentTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark'
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setTheme((document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ── Keyed editor — remounts on every new doc ──────────────────────────────────
function DocEditor({
  initialContent,
  rawContent,
  onChange,
  spellCheckOn,
}: {
  initialContent: any[] | undefined;
  rawContent: string;
  onChange: (content: string) => void;
  spellCheckOn: boolean;
}) {
  const editorTheme = useCurrentTheme();
  const editor = useCreateBlockNote({ schema, initialContent });
  const [errors, setErrors] = useState<SpellError[]>([]);
  const [popup, setPopup] = useState<{ word: string; suggestions: string[]; x: number; y: number } | null>(null);

  // Run spell check after content changes
  const runCheck = useCallback(() => {
    if (!spellCheckOn) { setErrors([]); return; }
    // Extract plain text from all blocks
    const text = editor.document
      .map((b: any) => {
        if (typeof b.content === 'string') return b.content;
        if (Array.isArray(b.content)) return b.content.map((c: any) => c.text ?? '').join('');
        return '';
      })
      .join('\n');
    setErrors(checkText(text));
  }, [spellCheckOn, editor]);

  useEffect(() => {
    if (!spellCheckOn) { setErrors([]); return; }
    loadDictionary(runCheck);
  }, [spellCheckOn, runCheck]);


  // Expand codeBlock blocks whose language is "markdown" or "md" into
  // actual rendered BlockNote blocks (headings, lists, paragraphs).
  // This lets users use ```markdown fences as rich-text templates.
  const expandMarkdownBlocks = useCallback(async (blocks: any[]): Promise<any[]> => {
    const out: any[] = [];
    for (const b of blocks) {
      const lang = (b.props?.language ?? '').toLowerCase();
      const text = Array.isArray(b.content)
        ? b.content.map((c: any) => c.text ?? '').join('')
        : '';
      const trimmed = text.trim();

      // Expand when:
      // 1. Language is explicitly "markdown" or "md"
      // 2. Language is empty/text and content clearly looks like markdown
      //    (starts with a heading marker # or ## or ####)
      const isMarkdownLang = lang === 'markdown' || lang === 'md';
      const looksLikeMarkdown = (lang === '' || lang === 'text') && /^#{1,6}\s/.test(trimmed);

      if (b.type === 'codeBlock' && (isMarkdownLang || looksLikeMarkdown) && trimmed) {
        try {
          const inner: any = editor.tryParseMarkdownToBlocks(wikiLinksToMarkdown(trimmed));
          const resolved: any[] = typeof inner?.then === 'function' ? await inner : inner;
          out.push(...resolved);
          continue;
        } catch {}
      }
      out.push(b);
    }
    return out;
  }, [editor]);

  // Pre-render mermaid fences in markdown to inline SVG images
  const renderMermaidInMarkdown = useCallback(async (md: string): Promise<string> => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: isDark ? {
        background: '#13111c',
        primaryColor: '#4f46e5',
        primaryTextColor: '#e2e0ff',
        primaryBorderColor: '#6366f1',
        lineColor: '#818cf8',
        secondaryColor: '#7c3aed',
        tertiaryColor: '#1e1b4b',
        mainBkg: '#1e1b4b',
        nodeBorder: '#6366f1',
        clusterBkg: '#1a1730',
        clusterBorder: '#4f46e5',
        titleColor: '#c7d2fe',
        edgeLabelBackground: '#312e81',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '15px',
      } : {
        primaryColor: '#6366f1',
        primaryTextColor: '#1e1b4b',
        primaryBorderColor: '#4338ca',
        lineColor: '#4f46e5',
        secondaryColor: '#a5b4fc',
        tertiaryColor: '#eef2ff',
        mainBkg: '#eef2ff',
        nodeBorder: '#4338ca',
        clusterBkg: '#e0e7ff',
        clusterBorder: '#4338ca',
        titleColor: '#1e1b4b',
        edgeLabelBackground: '#e0e7ff',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '15px',
      },
    });

    const FENCE = /```mermaid\r?\n([\s\S]*?)```/g;
    const jobs: Array<{ original: string; code: string }> = [];
    let m;
    while ((m = FENCE.exec(md)) !== null) jobs.push({ original: m[0], code: m[1].trim() });

    for (const job of jobs) {
      try {
        const { svg } = await mermaid.render('mmd' + Math.random().toString(36).slice(2, 8), job.code);
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        md = md.replace(job.original, `![Mermaid diagram](${url})`);
      } catch { /* keep original code block on parse error */ }
    }
    return md;
  }, []);

  // If initialContent is undefined the raw string is Markdown (e.g. written
  // by the MCP server). Convert it to BlockNote blocks after mount.
  useEffect(() => {
    if (initialContent !== undefined) {
      expandMarkdownBlocks(editor.document as any).then(expanded => {
        if (JSON.stringify(expanded) !== JSON.stringify(editor.document)) {
          editor.replaceBlocks(editor.document, expanded);
        }
      });
      return;
    }
    if (!rawContent || rawContent.trim() === '') return;

    (async () => {
      const processed = await renderMermaidInMarkdown(rawContent);
      const result = await editor.tryParseMarkdownToBlocks(wikiLinksToMarkdown(processed));
      if (result && result.length > 0) {
        const expanded = await expandMarkdownBlocks(result);
        // Set mermaid SVG images to full editor width
        const withLargeMermaid = expanded.map((block: any) => {
          if (block.type === 'image' && (block.props?.url ?? '').startsWith('data:image/svg+xml')) {
            return { ...block, props: { ...block.props, previewWidth: 740 } };
          }
          return block;
        });
        editor.replaceBlocks(editor.document, withLargeMermaid);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div spellCheck={false} style={{ position: 'relative' }}>
    <BlockNoteView
      editor={editor}
      theme={editorTheme}
      onChange={() => { onChange(JSON.stringify(editor.document)); if (spellCheckOn) setTimeout(runCheck, 600); }}
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

    {/* ── Spell-check error panel ── */}
    {spellCheckOn && errors.length > 0 && (
      <div style={{
        marginTop: 12, padding: '10px 14px',
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 8, fontSize: 13,
      }}>
        <div style={{ fontWeight: 600, color: 'var(--text2)', marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Spell Check — {errors.length} issue{errors.length !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {errors.slice(0, 30).map((e, i) => (
            <div
              key={i}
              onClick={(ev) => {
                const sugg = getSuggestions(e.word);
                setPopup({ word: e.word, suggestions: sugg, x: ev.clientX, y: ev.clientY });
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171', fontSize: 12.5, fontFamily: 'inherit',
              }}
            >
              {e.word}
            </div>
          ))}
          {errors.length > 30 && (
            <span style={{ color: 'var(--muted)', fontSize: 12, alignSelf: 'center' }}>
              +{errors.length - 30} more
            </span>
          )}
        </div>
      </div>
    )}

    {spellCheckOn && errors.length === 0 && (
      <div style={{ marginTop: 8, fontSize: 12, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Check size={13} /> No spelling issues found
      </div>
    )}

    {/* Suggestions popup */}
    {popup && (
      <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setPopup(null)} />
        <div style={{
          position: 'fixed', left: popup.x, top: popup.y + 8, zIndex: 200,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          minWidth: 140,
        }}>
          <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            Suggestions for <strong style={{ color: 'var(--text)' }}>{popup.word}</strong>
          </div>
          {popup.suggestions.length === 0 ? (
            <div style={{ padding: '4px 10px', fontSize: 13, color: 'var(--muted)' }}>No suggestions</div>
          ) : popup.suggestions.map((s, i) => (
            <button key={i} onClick={() => setPopup(null)} style={{
              display: 'block', width: '100%', padding: '5px 10px',
              background: 'none', border: 'none', textAlign: 'left',
              fontSize: 13, color: 'var(--text)', cursor: 'pointer',
              borderRadius: 4, fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {s}
            </button>
          ))}
        </div>
      </>
    )}
    </div>
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
  const [spellCheckOn, setSpellCheckOn] = useState(false);
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

          {/* Spell-check toggle */}
          <button
            onClick={() => setSpellCheckOn(p => !p)}
            title={spellCheckOn ? 'Disable spell check' : 'Enable spell check'}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', border: `1px solid ${spellCheckOn ? '#4ade80' : 'var(--border)'}`,
              borderRadius: 6, background: spellCheckOn ? 'rgba(74,222,128,0.1)' : 'var(--bg2)',
              color: spellCheckOn ? '#4ade80' : 'var(--text2)',
              fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <SpellCheck size={13} />
            {spellCheckOn ? 'Spell Check On' : 'Spell Check'}
          </button>

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
        <div className="page-inner" spellCheck={false}>

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
                spellCheckOn={spellCheckOn}
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
