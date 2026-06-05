use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

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

// ── Query param structs ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ProjectParam {
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PathParams {
    pub from: String,
    pub to: String,
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NeighborParams {
    pub id: String,
    /// Max hops to traverse (1–5, default 2).
    pub hops: Option<u32>,
    /// Filter by relation type: "wiki_link" | "parent_child" | "collection_member"
    pub relation_type: Option<String>,
    pub project_id: Option<String>,
}

// ── Extra response types ──────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PathResponse {
    pub found: bool,
    pub hops: usize,
    pub path: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
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
        .route("/path", get(find_path))
        .route("/neighbors", get(get_neighbors))
        .route("/:id", get(subgraph))
}

// ── Shared helper: load all edges for a project into memory ──────────────────

struct MemEdge {
    source: String,
    target: String,
    relation_type: String,
}

async fn load_edges(db: &sqlx::Pool<sqlx::Sqlite>, project_id: &str) -> Result<Vec<MemEdge>> {
    let mut edges: Vec<MemEdge> = sqlx::query_as::<_, EdgeRow>(
        "SELECT source_id AS source, target_id AS target, relation_type \
         FROM relations WHERE source_id IN (SELECT id FROM documents WHERE project_id = ?)",
    )
    .bind(project_id)
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|e| MemEdge { source: e.source, target: e.target, relation_type: e.relation_type })
    .collect();

    let pc = sqlx::query_as::<_, EdgeRow>(
        "SELECT parent_id AS source, id AS target, 'parent_child' AS relation_type \
         FROM documents WHERE parent_id IS NOT NULL AND project_id = ?",
    )
    .bind(project_id)
    .fetch_all(db)
    .await?;
    edges.extend(pc.into_iter().map(|e| MemEdge { source: e.source, target: e.target, relation_type: e.relation_type }));

    let cm = sqlx::query_as::<_, EdgeRow>(
        "SELECT collection_id AS source, id AS target, 'collection_member' AS relation_type \
         FROM documents WHERE collection_id IS NOT NULL AND parent_id IS NULL AND project_id = ?",
    )
    .bind(project_id)
    .fetch_all(db)
    .await?;
    edges.extend(cm.into_iter().map(|e| MemEdge { source: e.source, target: e.target, relation_type: e.relation_type }));

    Ok(edges)
}

async fn fetch_doc_nodes(
    db: &sqlx::Pool<sqlx::Sqlite>,
    ids: &[String],
    project_id: &str,
) -> Result<Vec<GraphNode>> {
    if ids.is_empty() { return Ok(vec![]); }
    let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT id, title, collection_id, parent_id, depth FROM documents \
         WHERE id IN ({}) AND project_id = ? ORDER BY depth ASC, sort_order ASC", ph
    );
    let mut q = sqlx::query_as::<_, DocRow>(&sql);
    for id in ids { q = q.bind(id); }
    q = q.bind(project_id);
    Ok(q.fetch_all(db).await?.into_iter().map(|d| GraphNode {
        id: d.id, title: d.title, node_type: "document".to_string(),
        collection_id: d.collection_id, parent_id: d.parent_id, depth: d.depth,
    }).collect())
}

async fn fetch_col_nodes(
    db: &sqlx::Pool<sqlx::Sqlite>,
    ids: &[String],
) -> Result<Vec<GraphNode>> {
    if ids.is_empty() { return Ok(vec![]); }
    let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT id, name FROM collections WHERE id IN ({})", ph);
    let mut q = sqlx::query_as::<_, ColRow>(&sql);
    for id in ids { q = q.bind(id); }
    Ok(q.fetch_all(db).await?.into_iter().map(|c| GraphNode {
        id: c.id, title: c.name, node_type: "collection".to_string(),
        collection_id: None, parent_id: None, depth: -1,
    }).collect())
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

// ── GET /api/graph/path?from=&to=&project_id= ─────────────────────────────────
// BFS shortest path (bidirectional edges) between two node IDs.

async fn find_path(
    State(state): State<AppState>,
    Query(params): Query<PathParams>,
) -> Result<Json<PathResponse>> {
    let project_id = params.project_id.unwrap_or_else(|| "default".to_string());
    let from = params.from;
    let to = params.to;

    if from == to {
        let nodes = fetch_doc_nodes(&state.db, &[from.clone()], &project_id).await?;
        return Ok(Json(PathResponse { found: true, hops: 0, path: nodes, edges: vec![] }));
    }

    let all_edges = load_edges(&state.db, &project_id).await?;

    // Build bidirectional adjacency: id → [(neighbor, relation_type, canon_source, canon_target)]
    let mut adj: HashMap<&str, Vec<(&str, &str, &str, &str)>> = HashMap::new();
    for e in &all_edges {
        adj.entry(e.source.as_str()).or_default()
            .push((e.target.as_str(), e.relation_type.as_str(), e.source.as_str(), e.target.as_str()));
        adj.entry(e.target.as_str()).or_default()
            .push((e.source.as_str(), e.relation_type.as_str(), e.source.as_str(), e.target.as_str()));
    }

    // BFS — track (current_id → (previous_id, relation_type, canon_src, canon_tgt))
    let mut prev: HashMap<String, Option<(String, String, String, String)>> = HashMap::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    prev.insert(from.clone(), None);
    queue.push_back(from.clone());

    let mut found = false;
    'bfs: while let Some(cur) = queue.pop_front() {
        if let Some(neighbors) = adj.get(cur.as_str()) {
            for (nb, rel, csrc, ctgt) in neighbors {
                if !prev.contains_key(*nb) {
                    prev.insert(
                        nb.to_string(),
                        Some((cur.clone(), rel.to_string(), csrc.to_string(), ctgt.to_string())),
                    );
                    if *nb == to.as_str() {
                        found = true;
                        break 'bfs;
                    }
                    queue.push_back(nb.to_string());
                }
            }
        }
    }

    if !found {
        return Ok(Json(PathResponse { found: false, hops: 0, path: vec![], edges: vec![] }));
    }

    // Reconstruct path backwards from `to`
    let mut path_ids: Vec<String> = vec![to.clone()];
    let mut path_edges: Vec<GraphEdge> = vec![];
    let mut cur = to.clone();
    while let Some(Some((p, rel, csrc, ctgt))) = prev.get(&cur) {
        path_edges.push(GraphEdge {
            source: csrc.clone(),
            target: ctgt.clone(),
            relation_type: rel.clone(),
        });
        path_ids.push(p.clone());
        cur = p.clone();
    }
    path_ids.reverse();
    path_edges.reverse();
    let hops = path_edges.len();

    // Fetch node details — mix of docs and collections
    let col_set: HashSet<&str> = all_edges.iter()
        .filter(|e| e.relation_type == "collection_member")
        .map(|e| e.source.as_str())
        .collect();
    let (doc_ids, col_ids): (Vec<String>, Vec<String>) = path_ids.iter()
        .cloned()
        .partition(|id| !col_set.contains(id.as_str()));

    let mut nodes = fetch_doc_nodes(&state.db, &doc_ids, &project_id).await?;
    nodes.extend(fetch_col_nodes(&state.db, &col_ids).await?);
    let order: HashMap<&str, usize> = path_ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    nodes.sort_by_key(|n| order.get(n.id.as_str()).copied().unwrap_or(usize::MAX));

    Ok(Json(PathResponse { found: true, hops, path: nodes, edges: path_edges }))
}

// ── GET /api/graph/neighbors?id=&hops=&relation_type=&project_id= ────────────
// All nodes within N hops, optionally filtered by relation type.

async fn get_neighbors(
    State(state): State<AppState>,
    Query(params): Query<NeighborParams>,
) -> Result<Json<GraphResponse>> {
    let project_id = params.project_id.unwrap_or_else(|| "default".to_string());
    let id = params.id;
    let max_hops = params.hops.unwrap_or(2).clamp(1, 5) as usize;
    let rel_filter = params.relation_type;

    let all_edges = load_edges(&state.db, &project_id).await?;

    // Optionally filter by relation type
    let edges: Vec<&MemEdge> = all_edges.iter()
        .filter(|e| rel_filter.as_deref().map_or(true, |r| e.relation_type == r))
        .collect();

    // Build bidirectional adjacency
    let mut adj: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    for e in &edges {
        adj.entry(e.source.as_str()).or_default().push((e.target.as_str(), e.relation_type.as_str()));
        adj.entry(e.target.as_str()).or_default().push((e.source.as_str(), e.relation_type.as_str()));
    }

    // BFS up to max_hops
    let mut visited: HashMap<String, usize> = HashMap::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    visited.insert(id.clone(), 0);
    queue.push_back((id.clone(), 0));

    while let Some((cur, hops)) = queue.pop_front() {
        if hops >= max_hops { continue; }
        if let Some(neighbors) = adj.get(cur.as_str()) {
            for (nb, _) in neighbors {
                if !visited.contains_key(*nb) {
                    visited.insert(nb.to_string(), hops + 1);
                    queue.push_back((nb.to_string(), hops + 1));
                }
            }
        }
    }

    let reachable_ids: Vec<String> = visited.keys().cloned().collect();

    // Separate collection ids from doc ids
    let col_set: HashSet<&str> = all_edges.iter()
        .filter(|e| e.relation_type == "collection_member")
        .map(|e| e.source.as_str())
        .collect();
    let (doc_ids, col_ids): (Vec<String>, Vec<String>) = reachable_ids.iter()
        .cloned()
        .partition(|id| !col_set.contains(id.as_str()));

    let mut nodes = fetch_doc_nodes(&state.db, &doc_ids, &project_id).await?;
    nodes.extend(fetch_col_nodes(&state.db, &col_ids).await?);

    // Collect edges within the reachable set
    let reachable_set: HashSet<&str> = reachable_ids.iter().map(String::as_str).collect();
    let result_edges: Vec<GraphEdge> = edges.iter()
        .filter(|e| reachable_set.contains(e.source.as_str()) && reachable_set.contains(e.target.as_str()))
        .map(|e| GraphEdge {
            source: e.source.clone(),
            target: e.target.clone(),
            relation_type: e.relation_type.clone(),
        })
        .collect();

    Ok(Json(GraphResponse { nodes, edges: result_edges }))
}
