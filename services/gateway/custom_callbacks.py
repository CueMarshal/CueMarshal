"""
Custom LiteLLM callbacks for the CueMarshal platform.
Tracks LLM costs per task, project, and agent role.
"""

import litellm
from litellm.integrations.custom_logger import CustomLogger
from datetime import datetime
import json
import os
import asyncio
from typing import List, Dict, Any
import httpx


class CueMarshalCostTracker(CustomLogger):
    """
    Tracks LLM costs per task and project for the CueMarshal platform.
    
    The Conductor and OpenCode agents pass metadata in the request:
    - task_id: UUID of the task
    - project: Project/repository name
    - agent_role: Agent role (developer, reviewer, etc.)
    
    This callback logs cost data and writes to Conductor's database via HTTP API.
    Uses buffered writes with retry logic to avoid latency impact.
    """

    def __init__(self):
        super().__init__()
        self.conductor_url = os.getenv("CONDUCTOR_URL", "http://conductor")
        self.buffer: List[Dict[str, Any]] = []
        self.buffer_lock = asyncio.Lock()
        self.buffer_size = int(os.getenv("COST_BUFFER_SIZE", "10"))
        self.flush_interval = int(os.getenv("COST_FLUSH_INTERVAL", "30"))
        self.retry_attempts = int(os.getenv("COST_RETRY_ATTEMPTS", "3"))
        self.last_flush_time = datetime.utcnow()

        # Start background flush task
        asyncio.create_task(self._periodic_flush())

    async def _periodic_flush(self):
        """Periodically flush buffer to avoid data loss."""
        while True:
            try:
                await asyncio.sleep(self.flush_interval)
                await self._flush_buffer()
            except Exception as e:
                print(f"[error] Periodic flush failed: {str(e)}")

    async def _flush_buffer(self, force: bool = False):
        """Flush buffered cost records to Conductor."""
        async with self.buffer_lock:
            if not self.buffer:
                return

            if not force and len(self.buffer) < self.buffer_size:
                # Check if we should flush based on time
                elapsed = (datetime.utcnow() - self.last_flush_time).total_seconds()
                if elapsed < self.flush_interval:
                    return

            # Take current buffer and clear it
            records_to_send = self.buffer[:]
            self.buffer = []
            self.last_flush_time = datetime.utcnow()

        # Send to Conductor (outside lock to avoid blocking)
        await self._send_to_conductor(records_to_send)

    async def _send_to_conductor(self, records: List[Dict[str, Any]]):
        """Send cost records to Conductor with retry logic."""
        url = f"{self.conductor_url}/api/internal/costs"
        payload = {"records": records}

        for attempt in range(self.retry_attempts):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(url, json=payload)
                    response.raise_for_status()

                    result = response.json()
                    print(f"[info] Flushed {result.get('count', 0)} cost records to Conductor")
                    return

            except httpx.HTTPError as e:
                print(f"[warn] Failed to send cost records (attempt {attempt + 1}/{self.retry_attempts}): {str(e)}")
                if attempt < self.retry_attempts - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
                else:
                    # Dead letter: log to stdout for recovery
                    print(f"[error] DEAD_LETTER: Failed to send cost records after {self.retry_attempts} attempts")
                    print(json.dumps({"event": "cost_dead_letter", "records": records}))
            except Exception as e:
                print(f"[error] Unexpected error sending cost records: {str(e)}")
                break

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Called after every successful LLM call."""
        try:
            metadata = kwargs.get("litellm_params", {}).get("metadata", {})

            # Calculate cost
            cost = litellm.completion_cost(
                completion_response=response_obj,
                model=kwargs.get("model", ""),
            )

            # Extract CueMarshal-specific metadata
            task_id = metadata.get("task_id")
            project = metadata.get("project", "unknown")
            agent_role = metadata.get("agent_role")
            model = kwargs.get("model", "unknown")

            # Calculate duration
            duration_ms = int((end_time - start_time) * 1000)

            # Extract token counts
            usage = response_obj.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)
            total_tokens = usage.get("total_tokens", 0)

            # Log for observability
            log_data = {
                "timestamp": datetime.utcnow().isoformat(),
                "event": "llm_success",
                "task_id": task_id,
                "project": project,
                "agent_role": agent_role,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "cost_usd": round(cost, 6),
                "duration_ms": duration_ms,
            }

            print(json.dumps(log_data))

            # Prepare cost record for database
            cost_record = {
                "task_id": task_id,
                "project": project,
                "agent_role": agent_role,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 6),
                "timestamp": datetime.utcnow().isoformat(),
            }

            # Add to buffer
            async with self.buffer_lock:
                self.buffer.append(cost_record)

            # Flush if buffer is full
            if len(self.buffer) >= self.buffer_size:
                await self._flush_buffer(force=True)

        except Exception as e:
            print(f"[error] Cost tracking failed: {str(e)}")

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Called after every failed LLM call."""
        try:
            metadata = kwargs.get("litellm_params", {}).get("metadata", {})

            task_id = metadata.get("task_id", "unknown")
            project = metadata.get("project", "unknown")
            agent_role = metadata.get("agent_role", "unknown")
            model = kwargs.get("model", "unknown")
            error = str(kwargs.get("exception", "unknown"))

            # Calculate duration
            duration_ms = int((end_time - start_time) * 1000)

            # Log failure
            log_data = {
                "timestamp": datetime.utcnow().isoformat(),
                "event": "llm_failure",
                "task_id": task_id,
                "project": project,
                "agent_role": agent_role,
                "model": model,
                "error": error,
                "duration_ms": duration_ms,
            }

            print(json.dumps(log_data))

        except Exception as e:
            print(f"[error] Failure logging failed: {str(e)}")


# Initialize the callback
cuemarshal_cost_tracker = CueMarshalCostTracker()
