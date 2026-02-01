/**
 * Gitea API client wrapper
 */

import { readFileSync } from "fs";
import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

const config = loadConfig();

/**
 * Role to token file mapping for role-based authentication
 */
const ROLE_TOKEN_MAP: Record<string, string> = {
  architect: "/tokens/architect_token",
  developer: "/tokens/developer_token",
  reviewer: "/tokens/reviewer_token",
  tester: "/tokens/tester_token",
  devops: "/tokens/devops_token",
  docs: "/tokens/docs_token",
  linter: "/tokens/linter_token",
};

/**
 * Resolve Gitea token based on role with fallback chain:
 * 1. Role-specific token file (/tokens/{role}_token)
 * 2. Legacy bot token from env var (GITEA_TOKEN)
 * 3. Legacy bot token from file (/tokens/bot_token)
 */
function resolveGiteaToken(role?: string): string {
  if (role && ROLE_TOKEN_MAP[role]) {
    try {
      const roleToken = readFileSync(ROLE_TOKEN_MAP[role], "utf-8").trim();
      if (roleToken) {
        logger.debug({ role }, "Loaded role-specific Gitea token");
        return roleToken;
      }
    } catch {
      logger.debug({ role }, "Role-specific token file not found, falling back");
    }
  }

  if (config.giteaToken) {
    // Check for file token first, as it's more likely to be fresh from init-gitea
    try {
      const fileToken = readFileSync("/tokens/bot_token", "utf-8").trim();
      if (fileToken) {
        logger.debug("Loaded Gitea token from /tokens/bot_token file (prioritized over env var)");
        return fileToken;
      }
    } catch {
      // File doesn't exist, fall back to env var
      logger.debug("No /tokens/bot_token found, using GITEA_TOKEN env var");
      return config.giteaToken;
    }
  }

  try {
    const fileToken = readFileSync("/tokens/bot_token", "utf-8").trim();
    if (fileToken) {
      logger.info("Loaded Gitea token from /tokens/bot_token file");
      return fileToken;
    }
  } catch {
    // File doesn't exist yet — init-gitea hasn't run
  }

  logger.warn("No Gitea token available — API calls will fail until init-gitea completes");
  return "";
}

export class GiteaClient {
  private baseUrl: string;
  private token: string;
  private role?: string;

  constructor(role?: string) {
    this.baseUrl = config.giteaUrl;
    this.role = role;
    this.token = resolveGiteaToken(role);
  }

  /**
   * Re-resolve token from file if current token is empty.
   * Called lazily on first API request when token was unavailable at startup.
   */
  private ensureToken(): void {
    if (!this.token) {
      this.token = resolveGiteaToken(this.role);
    }
  }

  /**
   * Create a client instance for a specific role
   */
  static forRole(role: string): GiteaClient {
    return new GiteaClient(role);
  }

  /**
   * Create a new repository in an organization
   */
  async createRepo(
    org: string,
    options: {
      name: string;
      description?: string;
      private?: boolean;
      auto_init?: boolean;
      default_branch?: string;
    }
  ): Promise<any> {
    logger.info({ org, repo: options.name }, "Creating repository");
    return this.request("POST", `/orgs/${org}/repos`, {
      name: options.name,
      description: options.description || "",
      private: options.private ?? false,
      auto_init: options.auto_init ?? true,
      default_branch: options.default_branch || "main",
    });
  }

  /**
   * Get list of repositories for an owner
   */
  async listRepos(owner: string): Promise<any[]> {
    return this.request("GET", `/orgs/${owner}/repos`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.ensureToken();
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      Authorization: `token ${this.token}`,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gitea API error (${response.status}): ${error}`);
      }

      if (response.status === 204) {
        return null as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      logger.error({ error, method, path }, "Gitea API request failed");
      throw error;
    }
  }

  // Issue operations
  async createIssue(owner: string, repo: string, data: {
    title: string;
    body?: string;
    labels?: number[];
    milestone?: number;
    assignees?: string[];
  }) {
    return this.request("POST", `/repos/${owner}/${repo}/issues`, data);
  }

  async getIssue(owner: string, repo: string, issueNumber: number) {
    return this.request("GET", `/repos/${owner}/${repo}/issues/${issueNumber}`);
  }

  async updateIssue(owner: string, repo: string, issueNumber: number, data: {
    title?: string;
    body?: string;
    state?: "open" | "closed";
    labels?: number[];
    assignees?: string[];
  }) {
    return this.request("PATCH", `/repos/${owner}/${repo}/issues/${issueNumber}`, data);
  }

  async addComment(owner: string, repo: string, issueNumber: number, body: string) {
    return this.request("POST", `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
  }

  async listIssues(owner: string, repo: string, params?: {
    state?: "open" | "closed" | "all";
    labels?: string;
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.state) queryParams.append("state", params.state);
    if (params?.labels) queryParams.append("labels", params.labels);
    queryParams.append("page", String(params?.page || 1));
    queryParams.append("limit", String(params?.limit || 20));
    // Ensure we only retrieve issues (and not pull requests) from Gitea
    queryParams.append("type", "issues");

    return this.request("GET", `/repos/${owner}/${repo}/issues?${queryParams}`);
  }

  // Milestone operations
  async createMilestone(owner: string, repo: string, data: {
    title: string;
    description?: string;
    due_on?: string;
    state?: "open" | "closed";
  }) {
    return this.request("POST", `/repos/${owner}/${repo}/milestones`, data);
  }

  async listMilestones(owner: string, repo: string, state?: "open" | "closed" | "all") {
    const params = new URLSearchParams();
    if (state) params.append("state", state);
    return this.request("GET", `/repos/${owner}/${repo}/milestones?${params}`);
  }

  // File operations (Contents API)
  async createOrUpdateFile(owner: string, repo: string, path: string, data: {
    content: string;
    message: string;
    branch?: string;
    sha?: string;
  }) {
    const payload: Record<string, string> = {
      content: Buffer.from(data.content).toString("base64"),
      message: data.message,
    };
    if (data.branch) payload.branch = data.branch;
    if (data.sha) payload.sha = data.sha;

    try {
      return await this.request("POST", `/repos/${owner}/${repo}/contents/${path}`, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Gitea API error (422)") || !message.includes("repository file already exists")) {
        throw error;
      }

      const refParam = data.branch ? `?ref=${encodeURIComponent(data.branch)}` : "";
      const existing = await this.request<{ sha: string }>(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}${refParam}`
      );
      const updatePayload = { ...payload, sha: existing.sha };
      return this.request("PUT", `/repos/${owner}/${repo}/contents/${path}`, updatePayload);
    }
  }

  // Workflow operations
  async dispatchWorkflow(owner: string, repo: string, workflowId: string, data: {
    ref: string;
    inputs: Record<string, string>;
  }) {
    return this.request(
      "POST",
      `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
      data
    );
  }

  // Label operations
  async getOrgLabels(org: string) {
    return this.request("GET", `/orgs/${org}/labels`);
  }

  async getRepoLabels(owner: string, repo: string) {
    return this.request("GET", `/repos/${owner}/${repo}/labels`);
  }

  async createOrgLabel(org: string, data: { name: string; color: string; description?: string }) {
    return this.request("POST", `/orgs/${org}/labels`, data);
  }

  // Webhook operations
  async createOrgWebhook(org: string, data: {
    type: string;
    config: {
      url: string;
      content_type: string;
      secret: string;
    };
    events: string[];
    active: boolean;
  }) {
    return this.request("POST", `/orgs/${org}/hooks`, data);
  }

  // Repository operations
  async getRepo(owner: string, repo: string) {
    return this.request("GET", `/repos/${owner}/${repo}`);
  }

  // Branch operations
  async createBranch(owner: string, repo: string, data: {
    new_branch_name: string;
    old_branch_name?: string;
  }) {
    return this.request("POST", `/repos/${owner}/${repo}/branches`, data);
  }

  async getBranch(owner: string, repo: string, branch: string) {
    return this.request("GET", `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  }

  // Pull request operations
  async createPullRequest(owner: string, repo: string, data: {
    title: string;
    body?: string;
    head: string;
    base: string;
    labels?: number[];
    assignees?: string[];
  }) {
    return this.request("POST", `/repos/${owner}/${repo}/pulls`, data);
  }

  async getPullRequest(owner: string, repo: string, prNumber: number) {
    return this.request("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  async mergePullRequest(owner: string, repo: string, prNumber: number, data?: {
    merge_message_field?: string;
    merge_when_checks_succeed?: boolean;
    Do?: "merge" | "rebase" | "squash";
    delete_branch_after_merge?: boolean;
  }) {
    return this.request("POST", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, data || {
      Do: "merge",
      delete_branch_after_merge: true,
    });
  }

  async createPullRequestReview(owner: string, repo: string, prNumber: number, data: {
    body: string;
    event: "APPROVED" | "REQUEST_CHANGES" | "COMMENT";
    comments?: Array<{
      path: string;
      body: string;
      new_position: number;
    }>;
  }) {
    return this.request("POST", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, data);
  }
}

export const giteaClient = new GiteaClient();
