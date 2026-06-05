import type {
  Collection, Document, DocumentDetail,
  DocumentVersion, Attachment, SearchResult,
  Project, ProjectDetail,
} from '../types';

const BASE = '/api';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (res.status === 401 && path !== '/auth/login') {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error ?? 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (username: string, password: string) =>
  req('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const logout = () =>
  req('/auth/logout', { method: 'POST' });
export const getMe = () =>
  req('/auth/me');
export const changePassword = (current_password: string, new_password: string) =>
  req('/auth/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) });

// ── Users ─────────────────────────────────────────────────────────────────────
export const getUsers = () => req('/users');
export const createUser = (username: string, password: string) =>
  req('/users', { method: 'POST', body: JSON.stringify({ username, password }) });
export const deleteUser = (id: string) =>
  req(`/users/${id}`, { method: 'DELETE' });

// ── API Keys ──────────────────────────────────────────────────────────────────
export const getApiKeys = () => req('/api-keys');
export const createApiKey = (name: string, project_id: string) =>
  req('/api-keys', { method: 'POST', body: JSON.stringify({ name, project_id }) });
export const deleteApiKey = (id: string) =>
  req(`/api-keys/${id}`, { method: 'DELETE' });

// ── Projects ─────────────────────────────────────────────────────────────────
export const getProjects = () => req<Project[]>('/projects');
export const createProject = (data: { name: string; description?: string; color?: string }) =>
  req<Project>('/projects', { method: 'POST', body: JSON.stringify(data) });
export const getProjectDetail = (id: string) => req<ProjectDetail>(`/projects/${id}`);
export const updateProject = (id: string, data: { name?: string; description?: string; color?: string }) =>
  req<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProject = (id: string) => req<void>(`/projects/${id}`, { method: 'DELETE' });

// ── Collections ─────────────────────────────────────────────────────────────
export const getCollections = (projectId = 'default') =>
  req<Collection[]>(`/collections?project_id=${projectId}`);
export const createCollection = (data: { name: string; description?: string }, projectId = 'default') =>
  req<Collection>(`/collections?project_id=${projectId}`, { method: 'POST', body: JSON.stringify(data) });
export const getCollection = (id: string) =>
  req<{ collection: Collection; root_docs: Document[] }>(`/collections/${id}`);
export const updateCollection = (id: string, data: Partial<Pick<Collection, 'name' | 'description' | 'icon'>>) =>
  req<Collection>(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCollection = (id: string) =>
  req<void>(`/collections/${id}`, { method: 'DELETE' });

// ── Documents ────────────────────────────────────────────────────────────────
export const listDocuments = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return req<{ data: Document[]; total: number; page: number; per_page: number }>(`/documents${qs}`);
};
export const createDocument = (data: {
  title: string; content?: string; brief?: string;
  collection_id?: string; parent_id?: string; tags?: string[];
  project_id?: string;
}) => req<Document>('/documents', { method: 'POST', body: JSON.stringify(data) });
export const getDocument = (id: string) => req<DocumentDetail>(`/documents/${id}`);
export const updateDocument = (id: string, data: {
  title?: string; content?: string; brief?: string;
  tags?: string[]; sort_order?: number;
}) => req<Document>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteDocument = (id: string) =>
  req<void>(`/documents/${id}`, { method: 'DELETE' });
export const getDocumentChildren = (id: string) => req<Document[]>(`/documents/${id}/children`);
export const getDocumentBacklinks = (id: string) => req<Document[]>(`/documents/${id}/backlinks`);
export const getDocumentVersions = (id: string) => req<DocumentVersion[]>(`/documents/${id}/versions`);
export const getDocumentAttachments = (id: string) => req<Attachment[]>(`/documents/${id}/attachments`);

// ── Search ───────────────────────────────────────────────────────────────────
export const search = (q: string, params?: Record<string, string>) => {
  const qs = new URLSearchParams({ q, ...params }).toString();
  return req<{ results: SearchResult[]; total: number }>(`/search?${qs}`);
};

// ── Attachments ──────────────────────────────────────────────────────────────
export const uploadAttachment = async (docId: string, file: File): Promise<Attachment> => {
  const form = new FormData();
  form.append('doc_id', docId);
  form.append('file', file);
  const res = await fetch(`${BASE}/attachments`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
};
export const getAttachmentUrl = (id: string) => `${BASE}/attachments/${id}`;

// ── Backup ───────────────────────────────────────────────────────────────────
export const browseDir = (path?: string) => {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return req<{ current: string; parent: string | null; entries: { name: string; path: string; is_dir: boolean }[] }>(`/backup/browse${qs}`);
};
export const createBackup = (destination: string) =>
  req<{ backup_path: string; size_mb: number }>('/backup', {
    method: 'POST',
    body: JSON.stringify({ destination }),
  });
export const mkdirBackup = (parent: string, name: string) =>
  req<{ path: string }>('/backup/mkdir', {
    method: 'POST',
    body: JSON.stringify({ parent, name }),
  });

// ── Settings ─────────────────────────────────────────────────────────────────
export interface AppSettings {
  manual_backup_dir?: string | null;
  auto_backup_dir?: string | null;
  auto_backup_hour?: number | null;
}
export const getSettings = () => req<AppSettings>('/settings');
export const saveSettings = (s: AppSettings) =>
  req<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(s) });

// ── Graph ────────────────────────────────────────────────────────────────────
export const getGraph = (projectId = 'default') =>
  req<{
    nodes: { id: string; title: string; node_type: string; depth: number; collection_id?: string; parent_id?: string }[];
    edges: { source: string; target: string; relation_type: string }[];
  }>(`/graph?project_id=${projectId}`);
