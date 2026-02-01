/**
 * BullMQ Job Definitions
 */

import { Queue } from "bullmq";
import { loadConfig } from "../config.js";

const config = loadConfig();

const redisUrl = new URL(config.redisUrl);
const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || "6379"),
  ...(redisUrl.password && { password: decodeURIComponent(redisUrl.password) }),
};

// Job queues
export const tasksQueue = new Queue("tasks", { connection: redisConnection });
export const reviewsQueue = new Queue("reviews", { connection: redisConnection });
export const workflowsQueue = new Queue("workflows", { connection: redisConnection });
export const maintenanceQueue = new Queue("maintenance", { connection: redisConnection });

// Job type definitions
export interface TaskAnalyzeJob {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  labels: string[];
}

export interface TaskRouteJob {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  labels: string[];
}

export interface ReviewAssignJob {
  owner: string;
  repo: string;
  prNumber: number;
  issueNumber: number | null;
  modelTier: string;
  branchName: string;
}

export interface PRMergeJob {
  owner: string;
  repo: string;
  prNumber: number;
  issueNumber: number | null;
}

export interface WorkflowResultJob {
  owner: string;
  repo: string;
  workflowRunId: number;
  status: string;
  conclusion: string;
}

// Job enqueueing helpers
export async function enqueueTaskAnalyze(data: TaskAnalyzeJob) {
  return tasksQueue.add("task:analyze", data, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  });
}

export async function enqueueTaskRoute(data: TaskRouteJob) {
  return tasksQueue.add("task:route", data, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
  });
}

export async function enqueueReviewAssign(data: ReviewAssignJob) {
  return reviewsQueue.add("review:assign", data, {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
  });
}

export async function enqueuePRMerge(data: PRMergeJob) {
  return reviewsQueue.add("pr:merge", data, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  });
}

export async function enqueueWorkflowResult(data: WorkflowResultJob) {
  return workflowsQueue.add("workflow:result", data);
}
