/**
 * Projects Board API Routes
 * Provides Kanban board data aggregated from Gitea issues, PRs, and branches.
 */

import { Router, Request, Response } from "express";
import { validateMobileToken } from "../middleware/auth.js";
import { giteaClient, GiteaClient } from "../services/gitea-client.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

const router = Router();

interface BoardCache {
  data: unknown;
  expiry: number;
}

const boardCache = new Map<string, BoardCache>();
const CACHE_TTL_MS = 30_000;

/**
 * GET /api/projects/board?repo=owner/name
 * Get Kanban board data: issues and PRs organised by workflow stage.
 */
router.get("/board", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const repoParam = (req.query.repo as string) || `${config.conductorOrg}/${config.conductorRepo}`;
    const authToken = (req as any).authToken as string | undefined;

    const cached = boardCache.get(repoParam);
    if (cached && Date.now() < cached.expiry) {
      res.json(cached.data);
      return;
    }

    const [owner, repo] = repoParam.split("/");
    if (!owner || !repo) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid repo format (expected owner/repo)" } });
      return;
    }

    // Use user's auth token if available, otherwise fall back to bot client
    const client = authToken ? GiteaClient.withToken(authToken) : giteaClient;

    const [issues, pullRequests] = await Promise.all([
      client.listIssues(owner, repo, { state: "all", limit: 50 }) as Promise<any[]>,
      client.listPullRequests(owner, repo, { state: "all", limit: 50 }) as Promise<any[]>,
    ]);

    // Build a set of issue numbers that have linked PRs
    const issuesWithPR = new Set<number>();
    for (const pr of pullRequests) {
      // Gitea PRs can reference issues via "closes #N" in the body
      const refs = extractIssueRefs(pr.body || "");
      refs.forEach((n) => issuesWithPR.add(n));
    }

    const backlog = issues.filter(
      (i: any) => i.state === "open" && !issuesWithPR.has(i.number) && !hasWIPLabel(i),
    );
    const inProgress = issues.filter(
      (i: any) => i.state === "open" && (issuesWithPR.has(i.number) || hasWIPLabel(i)),
    );
    const inReview = pullRequests.filter((p: any) => p.state === "open");
    const done = [
      ...issues.filter((i: any) => i.state === "closed").slice(0, 20),
      ...pullRequests.filter((p: any) => p.merged || p.state === "closed").slice(0, 20),
    ].sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 20);

    const board = {
      repo: repoParam,
      columns: {
        backlog: backlog.map(formatIssue),
        in_progress: inProgress.map(formatIssue),
        in_review: inReview.map(formatPR),
        done: done.map((item: any) => item.pull_request !== undefined ? formatPR(item) : formatIssue(item)),
      },
      summary: {
        total_issues: issues.length,
        total_prs: pullRequests.length,
        open_issues: issues.filter((i: any) => i.state === "open").length,
        open_prs: pullRequests.filter((p: any) => p.state === "open").length,
      },
    };

    boardCache.set(repoParam, { data: board, expiry: Date.now() + CACHE_TTL_MS });
    res.json(board);
  } catch (error) {
    logger.error({ error }, "Failed to fetch project board");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch board data" } });
  }
});

/**
 * GET /api/projects/repos
 * List repositories in the organization for the repo picker.
 */
router.get("/repos", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const authToken = (req as any).authToken as string | undefined;
    const client = authToken ? GiteaClient.withToken(authToken) : giteaClient;
    const repos = (await client.listRepos(config.conductorOrg)) as any[];

    res.json({
      repos: repos.map((r: any) => ({
        full_name: r.full_name,
        name: r.name,
        description: r.description,
        open_issues_count: r.open_issues_count,
        updated_at: r.updated_at,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to list repos");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to list repos" } });
  }
});

function extractIssueRefs(body: string): number[] {
  const matches = body.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/gi) || [];
  return matches.map((m) => parseInt(m.replace(/\D/g, ""), 10)).filter(Boolean);
}

function hasWIPLabel(issue: any): boolean {
  return (issue.labels || []).some((l: any) =>
    ["wip", "in-progress", "in progress", "working"].includes(l.name?.toLowerCase()),
  );
}

function formatIssue(issue: any) {
  return {
    type: "issue",
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: (issue.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
    assignees: (issue.assignees || []).map((a: any) => ({
      username: a.login || a.username,
      avatar_url: a.avatar_url,
    })),
    milestone: issue.milestone ? { title: issue.milestone.title } : null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    url: issue.html_url,
  };
}

function formatPR(pr: any) {
  return {
    type: "pull_request",
    number: pr.number,
    title: pr.title,
    state: pr.merged ? "merged" : pr.state,
    labels: (pr.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
    assignees: (pr.assignees || []).map((a: any) => ({
      username: a.login || a.username,
      avatar_url: a.avatar_url,
    })),
    head: pr.head?.ref,
    base: pr.base?.ref,
    mergeable: pr.mergeable,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    url: pr.html_url,
  };
}

export default router;
