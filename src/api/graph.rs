use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, Result},
    state::AppState,
};

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub node_type: String,       // "document" | "collection"
    pub collection_id: Option<String>,
    pub parent_id: Option<String>,
    pub depth: i64,
}

#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub relation_type: String,
}

#[derive(Debug, Serialize)]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// ── Query param struct ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ProjectParam {
    /// Restrict graph to a specific project (default: "default").
    pub project_id: Option<String>,
}

// ── Internal SQLx row types ───────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct DocRow {
    id: String,
    title: String,
    collection_id: Option<String>,
    parent_id: Option<String>,
    depth: i64,
}

#[derive(sqlx::FromRow)]
struct ColRow {
    id: String,
    name: String,
}

#[derive(sqlx::FromRow)]
struct EdgeRow {
    source: String,
    target: String,
    relation_type: String,
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(full_graph))
        .route("/:id", get(subgraph))
}

// ── GET /api/graph ────────────────────────────────────────────────────────────

async fn full_graph(
    State(state): State<AppState>,
    Query(params): Query<ProjectParam>,
) -> Result<Json<GraphResponse>> {
    let project_id = params.project_id.unwrap_or_else(|| "default".to_string());

    // 1. Collections as hub nodes
    let collections = sqlx::query_as::<_, ColRow>(
        "SELECT id, name FROM collections WHERE project_id = ? ORDER BY name ASC",
    )
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;

    // 2. Documents as leaf/branch nodes
    let docs = sqlx::query_as::<_, DocRow>(
        "SELECT id, title, collection_id, parent_id, depth \
         FROM documents WHERE project_id = ? ORDER BY depth ASC, sort_order ASC",
    )
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;

    // 3. Explicit wiki-link relations
    let mut edges: Vec<EdgeRow> = sqlx::query_as::<_, EdgeRow>(
        "SELECT source_id AS source, target_id AS target, relation_type \
         FROM relations WHERE source_id IN (SELECT id FROM documents WHERE project_id = ?)",
    )
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;

    // 4. Synthetic parent-child edges (doc → doc)
    let parent_child = sqlx::query_as::<_, EdgeRow>(
        "SELECT parent_id AS source, id AS target, 'parent_child' AS relation_type \
         FROM documents WHERE parent_id IS NOT NULL AND project_id = ?",
    )
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;
    edges.extend(parent_child);

    // 5. Collection → root-document edges
    let col_member = sqlx::query_as::<_, EdgeRow>(
        "SELECT collection_id AS source, id AS target, 'collection_member' AS relation_type \
         FROM documents WHERE collection_id IS NOT NULL AND parent_id IS NULL AND project_id = ?",
    )
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;
    edges.extend(col_member);

    // Merge nodes
    let mut nodes: Vec<GraphNode> = collections
        .into_iter()
        .map(|c| GraphNode {
            id: c.id,
            title: c.name,
            node_type: "collection".to_string(),
            collection_id: None,
            parent_id: None,
            depth: -1, // collections sit above all documents
        })
        .collect();

    nodes.extend(docs.into_iter().map(|d| GraphNode {
        id: d.id,
        title: d.title,
        node_type: "document".to_string(),
        collection_id: d.collection_id,
        parent_id: d.parent_id,
        depth: d.depth,
    }));

    Ok(Json(GraphResponse {
        nodes,
        edges: edges.into_iter().map(|e| GraphEdge {
            source: e.source,
            target: e.target,
            relation_type: e.relation_type,
        }).collect(),
    }))
}

// ── GET /api/graph/:id ────────────────────────────────────────────────────────

async fn subgraph(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(params): Query<ProjectParam>,
) -> Result<Json<GraphResponse>> {
    let project_id = params.project_id.unwrap_or_else(|| "default".to_string());

    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM documents WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("document '{}' not found", id)));
    }

    let reachable_ids: Vec<String> = sqlx::query_scalar::<_, String>(
        r#"
        WITH RECURSIVE reachable(id, hops) AS (
            SELECT ?, 0
            UNION
            SELECT r.target_id, rc.hops + 1
            FROM relations r INNER JOIN reachable rc ON r.source_id = rc.id WHERE rc.hops < 2
            UNION
            SELECT r.source_id, rc.hops + 1
            FROM relations r INNER JOIN reachable rc ON r.target_id = rc.id WHERE rc.hops < 2
            UNION
            SELECT d.id, rc.hops + 1
            FROM documents d INNER JOIN reachable rc ON d.parent_id = rc.id WHERE rc.hops < 2
            UNION
            SELECT d.parent_id, rc.hops + 1
            FROM documents d INNER JOIN reachable rc ON d.id = rc.id
            WHERE d.parent_id IS NOT NULL AND rc.hops < 2
        )
        SELECT DISTINCT id FROM reachable
        "#,
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    if reachable_ids.is_empty() {
        return Ok(Json(GraphResponse { nodes: vec![], edges: vec![] }));
    }

    let placeholders = reachable_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");

    // Doc nodes (filtered by project_id as well)
    let node_sql = format!(
        "SELECT id, title, collection_id, parent_id, depth FROM documents \
         WHERE id IN ({}) AND project_id = ? ORDER BY depth ASC, sort_order ASC",
        placeholders
    );
    let mut node_q = sqlx::query_as::<_, DocRow>(&node_sql);
    for rid in &reachable_ids { node_q = node_q.bind(rid); }
    node_q = node_q.bind(&project_id);
    let docs = node_q.fetch_all(&state.db).await?;

    // Collect unique collection ids for root docs in this subgraph
    let col_ids: Vec<String> = docs.iter()
        .filter(|d| d.parent_id.is_none())
        .filter_map(|d| d.collection_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let mut col_nodes: Vec<GraphNode> = Vec::new();
    if !col_ids.is_empty() {
        let col_ph = col_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let col_sql = format!("SELECT id, name FROM collections WHERE id IN ({})", col_ph);
        let mut col_q = sqlx::query_as::<_, ColRow>(&col_sql);
        for cid in &col_ids { col_q = col_q.bind(cid); }
        col_nodes = col_q.fetch_all(&state.db).await?
            .into_iter()
            .map(|c| GraphNode {
                id: c.id,
                title: c.name,
                node_type: "collection".to_string(),
                collection_id: None,
                parent_id: None,
                depth: -1,
            })
            .collect();
    }

    // Explicit wiki-link edges
    let rel_sql = format!(
        "SELECT source_id AS source, target_id AS target, relation_type FROM relations \
         WHERE source_id IN ({p}) AND target_id IN ({p})",
        p = placeholders
    );
    let mut edge_q = sqlx::query_as::<_, EdgeRow>(&rel_sql);
    for rid in &reachable_ids { edge_q = edge_q.bind(rid); }
    for rid in &reachable_ids { edge_q = edge_q.bind(rid); }
    let mut edges: Vec<EdgeRow> = edge_q.fetch_all(&state.db).await?;

    // Parent-child edges
    let par_sql = format!(
        "SELECT parent_id AS source, id AS target, 'parent_child' AS relation_type \
         FROM documents WHERE id IN ({p}) AND parent_id IN ({p})",
        p = placeholders
    );
    let mut par_q = sqlx::query_as::<_, EdgeRow>(&par_sql);
    for rid in &reachable_ids { par_q = par_q.bind(rid); }
    for rid in &reachable_ids { par_q = par_q.bind(rid); }
    edges.extend(par_q.fetch_all(&state.db).await?);

    // Collection-member edges
    for cid in &col_ids {
        let col_edge_sql = format!(
            "SELECT collection_id AS source, id AS target, 'collection_member' AS relation_type \
             FROM documents WHERE collection_id = ? AND parent_id IS NULL AND id IN ({})",
            placeholders
        );
        let mut col_edge_q = sqlx::query_as::<_, EdgeRow>(&col_edge_sql);
        col_edge_q = col_edge_q.bind(cid);
        for rid in &reachable_ids { col_edge_q = col_edge_q.bind(rid); }
        edges.extend(col_edge_q.fetch_all(&state.db).await?);
    }

    let mut nodes = col_nodes;
    nodes.extend(docs.into_iter().map(|d| GraphNode {
        id: d.id,
        title: d.title,
        node_type: "document".to_string(),
        collection_id: d.collection_id,
        parent_id: d.parent_id,
        depth: d.depth,
    }));

    Ok(Json(GraphResponse {
        nodes,
        edges: edges.into_iter().map(|e| GraphEdge {
            source: e.source,
            target: e.target,
            relation_type: e.relation_type,
        }).collect(),
    }))
}
