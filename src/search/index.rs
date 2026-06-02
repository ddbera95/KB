use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, QueryParser, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, STORED, STRING, TEXT,
};
use tantivy::schema::OwnedValue;
use tantivy::snippet::SnippetGenerator;
use tantivy::{doc, Index, IndexReader, IndexWriter, TantivyDocument, Term};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub brief: Option<String>,
    pub snippet: String,
    pub score: f32,
}

pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    field_id: Field,
    field_title: Field,
    field_content: Field,
    field_tags: Field,
    field_collection_id: Field,
    field_brief: Field,
    field_project_id: Field,
}

impl SearchIndex {
    /// Schema version — bump this string whenever the Tantivy schema changes.
    /// On mismatch the old index directory is wiped and recreated. The SQLite
    /// database is the source of truth; Tantivy is a pure search cache.
    const SCHEMA_VERSION: &'static str = "v3-project-id";

    pub fn new(index_dir: &Path) -> Result<Self> {
        let version_file = index_dir.join(".schema_version");

        // If the stored schema version doesn't match, wipe the index so the
        // new schema (STRING | STORED for id) takes effect.
        let version_ok = std::fs::read_to_string(&version_file)
            .map(|v| v.trim() == Self::SCHEMA_VERSION)
            .unwrap_or(false);

        if !version_ok {
            let _ = std::fs::remove_dir_all(index_dir);
        }
        std::fs::create_dir_all(index_dir)
            .with_context(|| format!("Failed to create index dir: {}", index_dir.display()))?;

        let mut sb = Schema::builder();

        // STRING | STORED — indexed as a single exact token (required for delete_term
        // to work correctly) and stored so we can retrieve the value in search results.
        let field_id = sb.add_text_field("id", STRING | STORED);
        let field_title = sb.add_text_field("title", TEXT | STORED);
        let content_opts = TextOptions::default().set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("en_stem")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        );
        let field_content = sb.add_text_field("content", content_opts);
        let field_tags = sb.add_text_field("tags", TEXT | STORED);
        // STRING so we can filter by exact collection id
        let field_collection_id = sb.add_text_field("collection_id", STRING | STORED);
        let field_brief = sb.add_text_field("brief", STORED);
        // STRING so we can filter by exact project id
        let field_project_id = sb.add_text_field("project_id", STRING | STORED);

        let schema = sb.build();

        let index = if index_dir.join("meta.json").exists() {
            Index::open_in_dir(index_dir)
                .with_context(|| format!("Failed to open index at {}", index_dir.display()))?
        } else {
            Index::create_in_dir(index_dir, schema.clone())
                .with_context(|| format!("Failed to create index at {}", index_dir.display()))?
        };

        // Write version file so future startups know the schema is current.
        std::fs::write(&version_file, Self::SCHEMA_VERSION)
            .context("Failed to write schema version file")?;

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .context("Failed to build index reader")?;

        Ok(Self {
            index, reader,
            field_id, field_title, field_content,
            field_tags, field_collection_id, field_brief,
            field_project_id,
        })
    }

    /// Index (or re-index) a single document. The previous copy is deleted first
    /// by exact id term — this works because field_id is STRING-indexed.
    pub fn index_document(
        &self,
        id: &str,
        title: &str,
        content: &str,
        tags: &[String],
        collection_id: Option<&str>,
        brief: Option<&str>,
        project_id: &str,
    ) -> Result<()> {
        let mut writer: IndexWriter = self.index
            .writer(50_000_000)
            .context("Failed to create index writer")?;

        // Delete the old version (noop if it doesn't exist yet).
        writer.delete_term(Term::from_field_text(self.field_id, id));

        let tags_str = tags.join(" ");
        let mut document = doc!(
            self.field_id         => id,
            self.field_title      => title,
            self.field_content    => content,
            self.field_tags       => tags_str.as_str(),
            self.field_project_id => project_id,
        );
        if let Some(cid) = collection_id {
            document.add_text(self.field_collection_id, cid);
        }
        if let Some(b) = brief {
            document.add_text(self.field_brief, b);
        }

        writer.add_document(document).context("Failed to add document")?;
        writer.commit().context("Failed to commit")?;
        self.reader.reload().context("Failed to reload reader")?;
        Ok(())
    }

    /// Remove a document from the index.
    pub fn delete_document(&self, id: &str) -> Result<()> {
        let mut writer: IndexWriter = self.index
            .writer(50_000_000)
            .context("Failed to create index writer")?;
        writer.delete_term(Term::from_field_text(self.field_id, id));
        writer.commit().context("Failed to commit delete")?;
        self.reader.reload().context("Failed to reload reader")?;
        Ok(())
    }

    /// Full-text search, optionally filtered to a specific collection.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        collection_id: Option<&str>,
    ) -> Result<Vec<SearchResult>> {
        let searcher = self.reader.searcher();

        let mut parser = QueryParser::for_index(
            &self.index,
            vec![self.field_title, self.field_content, self.field_tags],
        );
        // Boost title matches so they rank higher than body matches
        parser.set_field_boost(self.field_title, 2.0);

        let parsed = parser
            .parse_query(query)
            .with_context(|| format!("Failed to parse query: {}", query))?;

        let final_query: Box<dyn tantivy::query::Query> = if let Some(cid) = collection_id {
            let cid_filter = Box::new(TermQuery::new(
                Term::from_field_text(self.field_collection_id, cid),
                IndexRecordOption::Basic,
            ));
            Box::new(BooleanQuery::new(vec![
                (Occur::Must, parsed),
                (Occur::Must, cid_filter),
            ]))
        } else {
            parsed
        };

        let top_docs = searcher
            .search(&final_query, &TopDocs::with_limit(limit))
            .context("Search execution failed")?;

        let snippet_gen =
            SnippetGenerator::create(&searcher, &*final_query, self.field_content)
                .context("Failed to create snippet generator")?;

        let mut results = Vec::with_capacity(top_docs.len());

        for (score, addr) in top_docs {
            let retrieved: TantivyDocument =
                searcher.doc(addr).context("Failed to retrieve document")?;

            let id = retrieved
                .get_first(self.field_id)
                .and_then(|v| if let OwnedValue::Str(s) = v { Some(s.as_str()) } else { None })
                .unwrap_or("").to_string();

            let title = retrieved
                .get_first(self.field_title)
                .and_then(|v| if let OwnedValue::Str(s) = v { Some(s.as_str()) } else { None })
                .unwrap_or("").to_string();

            let brief = retrieved
                .get_first(self.field_brief)
                .and_then(|v| if let OwnedValue::Str(s) = v { Some(s.as_str()) } else { None })
                .map(|s| s.to_string());

            let snippet = snippet_gen.snippet_from_doc(&retrieved).fragment().to_string();

            results.push(SearchResult { id, title, brief, snippet, score });
        }

        Ok(results)
    }
}
