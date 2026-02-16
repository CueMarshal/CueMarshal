# Vector MCP Server

MCP server providing semantic search over project history using pgvector.

## Purpose

Solves the **context fragmentation problem**: Agents in isolated runners don't know about previous work, architectural patterns, or past decisions. This server provides project memory through vector similarity search.

## Tools

### Search Tools
- `search_similar_issues` - Find past issues similar to current task
- `search_code_patterns` - Find existing code patterns to follow
- `get_architectural_context` - Retrieve relevant design docs and ADRs
- `find_related_prs` - Find related PRs for context

### Indexing Tools
- `index_content` - Index content for search (called by Conductor)

## Database Schema

Requires PostgreSQL with pgvector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE project_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  content_text TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project, content_type, content_ref)
);

CREATE INDEX ON project_embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON project_embeddings (project, content_type);
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection with pgvector |
| `GATEWAY_URL` | Yes | LLM Gateway for embeddings |
| `GATEWAY_API_KEY` | Yes | Gateway API key |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4203`) |

## Usage

### In Agent Prompts

Add to developer agent:
```markdown
Before implementing, use vector tools:
1. search_similar_issues - Check if this was solved before
2. search_code_patterns - Find existing implementation patterns
3. get_architectural_context - Review relevant design docs
```

### Indexing Pipeline

Conductor automatically indexes:
- Merged PRs (title + body + diff)
- Closed issues (title + body + resolution)
- Design docs (on commit to `docs/design/`)
- Code files (on significant changes)

## Benefits

- **Consistency**: Agents follow existing patterns
- **Context**: Agents see what was done before
- **Learning**: New tasks benefit from past solutions
- **Efficiency**: Reduces "reinventing the wheel"
