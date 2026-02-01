# Conductor Queue

BullMQ-based job queue system for asynchronous task processing, review handling, and self-healing recovery.

## Files

| File | Description |
|------|-------------|
| `jobs.ts` | Defines BullMQ queues (tasks, reviews, workflows, maintenance) and typed job interfaces with enqueue helpers |
| `worker.ts` | BullMQ workers that process jobs — task analysis, agent routing, code review assignment, PR merging, and workflow results |
| `recovery.ts` | Self-healing recovery service that detects and re-triggers orphaned issues caused by crashes or migration failures |

## Purpose

This module decouples webhook-driven events from their processing. Incoming webhooks enqueue jobs, and workers process them asynchronously with retry and escalation support. The recovery service ensures no task is permanently lost.
