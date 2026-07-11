import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import memory_service.service as service
from memory_service.service import (
    bounded_limit,
    embedding_provider,
    embedding_settings,
    event_to_record,
    has_embedding_credentials,
    health_status,
    list_memory,
    parse_json_bytes,
    row_to_graph_item,
    row_to_memory,
    run_async,
    validate_events,
    yandex_embedding_input,
)


event = {
    "id": "mem-1",
    "kind": "weak_topic",
    "text": "Путает missing flag и fillna",
    "source": "assistant_chat",
    "evidence": {
        "projectId": "fill-and-flag",
        "graph": {"subject": "user", "relation": "struggles_with", "object": "missing value handling"},
    },
    "reviewStatus": "accepted",
    "createdAt": "2026-07-03T10:00:00Z",
}

record = event_to_record(event)
assert record == {
    "uuid": "mem-1",
    "subject": "user",
    "relation": "struggles_with",
    "object": "missing value handling",
    "fact": "Путает missing flag и fillna",
    "group_id": "fill-and-flag",
    "created_at": "2026-07-03T10:00:00Z",
}

fallback = event_to_record({**event, "source": "manual", "evidence": {"taskId": "task-1"}})
assert fallback["subject"] == "user"
assert fallback["relation"] == "weak_topic"
assert fallback["object"] == event["text"]
assert fallback["group_id"] == "task-1"

assert row_to_memory(["edge-1", "Путает порядок fillna и missing flag", "", ""]) == {
    "uuid": "edge-1",
    "fact": "Путает порядок fillna и missing flag",
    "validAt": "",
    "invalidAt": "",
}
assert row_to_graph_item(["edge-1", "user", "struggles_with", "data leakage", "Путает data leakage", "2026-07-10T09:00:00Z"]) == {
    "uuid": "edge-1",
    "subject": "user",
    "relation": "struggles_with",
    "object": "data leakage",
    "fact": "Путает data leakage",
    "createdAt": "2026-07-10T09:00:00Z",
}

assert bounded_limit("3") == 3
assert bounded_limit("bad") == 8
assert bounded_limit("999") == 50
assert bounded_limit("-5") == 1
assert parse_json_bytes(b'{"events": []}') == {"events": []}
assert parse_json_bytes(b"[1, 2]") is None
assert parse_json_bytes(b"{bad") is None
assert validate_events([event]) is None
assert validate_events(["bad"]) == "invalid_memory_event"
assert validate_events([{**event, "kind": "random_note"}]) == "invalid_memory_event_kind"
assert validate_events([{**event, "source": "random_source"}]) == "invalid_memory_event_source"
assert validate_events([{**event, "evidence": ["task"]}]) == "invalid_memory_event_evidence"
assert validate_events([{**event, "evidence": {"graph": {"subject": "user", "relation": "prefers"}}}]) == "invalid_memory_graph"
assert validate_events([{**event, "evidence": {"graph": {"subject": "user", "relation": "prefers", "object": "x", "extra": "no"}}}]) == "invalid_memory_graph"
assert validate_events([{**event, "evidence": {"graph": {"subject": "user", "relation": "prefers", "object": "OPENAI_API_KEY=do-not-store"}}}]) == "sensitive_memory_data"
assert validate_events([{**event, "text": "OPENAI_API_KEY=do-not-store"}]) == "sensitive_memory_data"
assert validate_events([{**event, "text": "x" * 5001}]) == "memory_event_too_large"
assert validate_events([{**event, "evidence": {"blob": "x" * 20001}}]) == "memory_event_too_large"
assert "run_until_complete" in run_async.__code__.co_names
assert yandex_embedding_input("text") == "text"
assert yandex_embedding_input(b"text") == "text"
assert yandex_embedding_input(["a", "b"]) == '["a", "b"]'


class FakeGraph:
    def __init__(self, error=None):
        self.error = error

    async def ro_query(self, _query, _params=None):
        raise AssertionError("health probe must initialize an empty graph with query")

    async def query(self, _query, _params=None):
        if self.error:
            raise self.error
        return object()


class EmptyGraph:
    async def ro_query(self, _query, _params=None):
        raise RuntimeError("Invalid graph operation on empty key")


async def empty_graph_client(_group_id="codelearn-local"):
    return EmptyGraph()


async def ready_graph_client():
    return FakeGraph()


async def broken_graph_client():
    return FakeGraph(RuntimeError("falkor unavailable"))


original_graph_client = service.graph_client
managed_env = [
    "OPENAI_API_KEY",
    "OPENAI_ADMIN_KEY",
    "OPENROUTER_API_KEY",
    "GRAPH_OPENAI_API_KEY",
    "GRAPH_OPENROUTER_API_KEY",
    "GRAPH_YANDEX_AI_STUDIO_API_KEY",
    "GRAPH_YANDEX_AI_STUDIO_FOLDER_ID",
    "YANDEX_AI_STUDIO_API_KEY",
    "YANDEX_AI_STUDIO_FOLDER_ID",
    "GRAPH_EMBEDDING_PROVIDER",
    "GRAPH_EMBEDDING_BASE_URL",
    "GRAPH_EMBEDDING_MODEL",
    "GRAPH_EMBEDDING_DIM",
    # Compatibility names must remain readable for existing local settings.
    "GRAPHITI_LLM_PROVIDER",
    "GRAPHITI_EMBEDDING_BASE_URL",
    "GRAPHITI_EMBEDDING_MODEL",
    "GRAPHITI_EMBEDDING_DIM",
]
original_env = {key: os.environ.get(key) for key in managed_env}
try:
    for key in managed_env:
        os.environ.pop(key, None)
    status, payload = asyncio.run(health_status())
    assert status == 503
    assert payload["error"] == "missing_graph_memory_credentials"
    assert embedding_provider() == "openai"
    assert has_embedding_credentials() is False

    os.environ["OPENROUTER_API_KEY"] = "test-openrouter-key"
    assert embedding_provider() == "openrouter"
    assert has_embedding_credentials() is True
    openrouter_settings = embedding_settings()
    assert openrouter_settings["base_url"] == "https://openrouter.ai/api/v1"
    assert openrouter_settings["model"] == "openai/text-embedding-3-small"
    assert openrouter_settings["embedding_dim"] == 1536

    os.environ.pop("OPENROUTER_API_KEY")
    os.environ["YANDEX_AI_STUDIO_API_KEY"] = "test-yandex-key"
    os.environ["YANDEX_AI_STUDIO_FOLDER_ID"] = "folder-123"
    assert embedding_provider() == "yandex"
    assert has_embedding_credentials() is True
    yandex_settings = embedding_settings()
    assert yandex_settings["base_url"] == "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding"
    assert yandex_settings["model"] == "emb://folder-123/text-embeddings-v2-doc"
    assert yandex_settings["embedding_dim"] == 256

    service.graph_client = ready_graph_client
    status, payload = asyncio.run(health_status())
    assert status == 200
    assert payload["ready"] is True
    assert payload["mode"] == "direct-triples"

    service.graph_client = empty_graph_client
    assert asyncio.run(list_memory("empty-project", 10)) == {"ok": True, "groupId": "empty-project", "items": []}

    service.graph_client = broken_graph_client
    status, payload = asyncio.run(health_status())
    assert status == 503
    assert payload["error"] == "graph_memory_unavailable"
    assert "falkor unavailable" in payload["message"]
finally:
    service.graph_client = original_graph_client
    for key, value in original_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

print("memory-service-check passed")
