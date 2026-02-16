/**
 * Vector store operations using pgvector
 */

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

interface SearchParams {
  query: string;
  project: string;
  contentType?: string;
  fileType?: string;
  limit: number;
}

/**
 * Generate embedding for text using LLM Gateway
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const gatewayUrl = process.env.GATEWAY_URL || "http://gateway";
  const apiKey = process.env.GATEWAY_API_KEY;

  const response = await fetch(`${gatewayUrl}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: "text-embedding-3-small",
    }),
  });

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}

/**
 * Search for similar content using vector similarity
 */
export async function searchVectors(params: SearchParams): Promise<any[]> {
  const embedding = await generateEmbedding(params.query);
  const embeddingStr = `[${embedding.join(",")}]`;

  let query = `
    SELECT 
      id,
      project,
      content_type,
      content_ref,
      content_text,
      metadata,
      1 - (embedding <=> $1::vector) AS similarity
    FROM project_embeddings
    WHERE project = $2
  `;

  const queryParams: any[] = [embeddingStr, params.project];
  let paramIndex = 3;

  if (params.contentType) {
    query += ` AND content_type = $${paramIndex}`;
    queryParams.push(params.contentType);
    paramIndex++;
  }

  if (params.fileType) {
    query += ` AND metadata->>'file_type' = $${paramIndex}`;
    queryParams.push(params.fileType);
    paramIndex++;
  }

  query += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIndex}`;
  queryParams.push(params.limit);

  const result = await pool.query(query, queryParams);
  return result.rows;
}

/**
 * Index new content with embedding
 */
export async function indexContent(params: {
  project: string;
  content_type: string;
  content_ref: string;
  content_text: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const embedding = await generateEmbedding(params.content_text);
  const embeddingStr = `[${embedding.join(",")}]`;

  await pool.query(
    `INSERT INTO project_embeddings (project, content_type, content_ref, content_text, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5::vector, $6)
     ON CONFLICT (project, content_type, content_ref) 
     DO UPDATE SET content_text = $4, embedding = $5::vector, metadata = $6`,
    [
      params.project,
      params.content_type,
      params.content_ref,
      params.content_text,
      embeddingStr,
      JSON.stringify(params.metadata || {}),
    ]
  );
}
