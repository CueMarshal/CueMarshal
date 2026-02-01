/**
 * Structured logging with Pino
 * Includes correlation ID support for distributed tracing
 */

import pino from "pino";
import { randomUUID } from "crypto";
import { loadConfig } from "../config.js";

const config = loadConfig();

export const logger = pino({
  level: config.logLevel,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport:
    config.nodeEnv === "development"
      ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "SYS:standard",
        },
      }
      : undefined,
});

/**
 * Generate a unique correlation ID for tracking self-improvement cycles
 */
export function generateCorrelationId(): string {
  return `si-${Date.now()}-${randomUUID()}`;
}

/**
 * Create a child logger with a correlation ID
 */
export function createCorrelatedLogger(correlationId: string) {
  return logger.child({ correlationId });
}

/**
 * Standard event types for self-improvement cycle
 */
export enum SelfImproveEvent {
  SCHEDULE_FIRED = "self_improve.schedule_fired",
  TRIGGER_EMITTED = "self_improve.trigger_emitted",
  WORKFLOW_STARTED = "self_improve.workflow_started",
  OPENCODE_EXECUTED = "self_improve.opencode_executed",
  MCP_TOOL_CALLED = "self_improve.mcp_tool_called",
  ISSUE_CREATED = "self_improve.issue_created",
  CYCLE_COMPLETED = "self_improve.cycle_completed",
  CYCLE_FAILED = "self_improve.cycle_failed",
  THRESHOLD_EXCEEDED = "self_improve.threshold_exceeded",
  AUTO_PAUSED = "self_improve.auto_paused",
}

/**
 * Log a structured self-improvement event
 */
export function logSelfImproveEvent(
  event: SelfImproveEvent,
  data: Record<string, unknown>,
  correlationId?: string
) {
  const logData = {
    event,
    timestamp: new Date().toISOString(),
    correlationId: correlationId || "unknown",
    ...data,
  };

  if (
    String(event).includes("failed") ||
    String(event).includes("threshold") ||
    String(event).includes("paused")
  ) {
    logger.error(logData, String(event));
  } else {
    logger.info(logData, String(event));
  }
}
