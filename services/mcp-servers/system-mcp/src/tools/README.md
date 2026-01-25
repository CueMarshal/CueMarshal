# System MCP Tools

MCP tool definitions for monitoring platform health, LLM costs, and runner utilization.

## Files

| File | Description |
|------|-------------|
| `costs.ts` | Query LLM spending summaries by period, project, or model and retrieve budget status |
| `health.ts` | Check health of all platform services (Gitea, Conductor, Gateway, Redis) with latency metrics |
| `runners.ts` | Get current runner utilization, queue depth, and status for individual or all runners |

## Purpose

This module provides observability tools that let agents and the chat handler monitor system-wide health, track LLM spending against budgets, and assess runner capacity — enabling informed decisions about task scheduling and cost management.
