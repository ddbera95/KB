export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectDetail extends Project {
  collections_count: number;
  documents_count: number;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  created_at: number;
  updated_at: number;
}

export interface Document {
  id: string;
  collection_id?: string;
  parent_id?: string;
  title: string;
  slug: string;
  brief?: string;
  content: string;
  depth: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface DocumentDetail {
  document: Document;
  tags: string[];
  children: Document[];
  breadcrumb: BreadcrumbItem[];
}

export interface BreadcrumbItem {
  id: string;
  title: string;
  slug: string;
}

export interface DocumentVersion {
  id: string;
  doc_id: string;
  version_number: number;
  title: string;
  content: string;
  created_at: number;
}

export interface Attachment {
  id: string;
  doc_id: string;
  filename: string;
  path: string;
  mime_type: string;
  size: number;
  created_at: number;
}

export interface SearchResult {
  id: string;
  title: string;
  brief?: string;
  snippet: string;
  score: number;
  breadcrumb: BreadcrumbItem[];
}
