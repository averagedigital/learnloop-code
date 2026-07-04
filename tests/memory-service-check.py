import asyncio
import os
import sys
from datetime import timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import memory_service.service as service
from memory_service.service import (
    Handler,
    bounded_limit,
    event_to_episode,
    graphiti_provider,
    has_graphiti_credentials,
    health_status,
    parse_json_bytes,
    result_to_memory,
    run_async,
    validate_events,
    yandex_embedding_input,
    yandex_graphiti_settings,
)


event = {
    "id": "mem-1",
    "kind": "weak_topic",
    "text": "Путает missing flag и fillna",
    "source": "task_run",
    "evidence": {"taskId": "fill-and-flag"},
    "reviewStatus": "accepted",
    "createdAt": "2026-07-03T10:00:00Z",
}

episode = event_to_episode(event)

assert episode["name"] == "codelearn_memory_mem-1"
assert episode["group_id"] == "fill-and-flag"
assert '"reviewStatus": "accepted"' in episode["body"]
assert '"taskId": "fill-and-flag"' in episode["body"]
assert episode["reference_time"].tzinfo == timezone.utc


class Result:
    uuid = "edge-1"
    fact = "Путает порядок fillna и missing flag"
    valid_at = None
    invalid_at = None


memory = result_to_memory(Result())
assert memory == {
    "uuid": "edge-1",
    "fact": "Путает порядок fillna и missing flag",
    "validAt": "",
    "invalidAt": "",
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
assert validate_events([{**event, "text": "x" * 5001}]) == "memory_event_too_large"
assert validate_events([{**event, "evidence": {"blob": "x" * 20001}}]) == "memory_event_too_large"
assert "run_until_complete" in run_async.__code__.co_names
assert yandex_embedding_input("text") == "text"
assert yandex_embedding_input(b"text") == "text"
assert yandex_embedding_input(["a", "b"]) == '["a", "b"]'


async def ready_client():
    return object(), object()


async def broken_client():
    raise RuntimeError("falkor unavailable")


original_graphiti_client = service.graphiti_client
managed_env = [
    "OPENAI_API_KEY",
    "OPENAI_ADMIN_KEY",
    "GRAPHITI_LLM_PROVIDER",
    "YANDEX_AI_STUDIO_API_KEY",
    "YANDEX_AI_STUDIO_FOLDER_ID",
    "YANDEX_AI_STUDIO_BASE_URL",
    "YANDEX_GRAPHITI_EMBEDDING_URL",
    "YANDEX_GRAPHITI_MODEL",
    "YANDEX_GRAPHITI_SMALL_MODEL",
    "YANDEX_GRAPHITI_EMBEDDING_MODEL",
    "YANDEX_GRAPHITI_EMBEDDING_DIM",
    "YANDEX_GRAPHITI_MAX_TOKENS",
]
original_env = {key: os.environ.get(key) for key in managed_env}
try:
    for key in managed_env:
        os.environ.pop(key, None)
    status, payload = asyncio.run(health_status())
    assert status == 503
    assert payload["error"] == "missing_graph_memory_credentials"
    assert "alive" in Handler.do_GET.__code__.co_consts
    assert graphiti_provider() == "openai"
    assert has_graphiti_credentials() is False

    os.environ["YANDEX_AI_STUDIO_API_KEY"] = "test-yandex-key"
    os.environ["YANDEX_AI_STUDIO_FOLDER_ID"] = "folder-123"
    assert graphiti_provider() == "yandex"
    assert has_graphiti_credentials() is True
    yandex_settings = yandex_graphiti_settings()
    assert yandex_settings["base_url"] == "https://ai.api.cloud.yandex.net/v1"
    assert yandex_settings["embedding_url"] == "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding"
    assert yandex_settings["model"] == "gpt://folder-123/deepseek-v4-flash"
    assert yandex_settings["small_model"] == "gpt://folder-123/deepseek-v4-flash"
    assert yandex_settings["embedding_model"] == "emb://folder-123/text-embeddings-v2-doc"
    assert yandex_settings["embedding_dim"] == 256
    assert yandex_settings["max_tokens"] == 4096
    assert yandex_settings["structured_output_mode"] == "json_object"

    for key in managed_env:
        os.environ.pop(key, None)

    service.graphiti_client = ready_client
    status, payload = asyncio.run(health_status())
    assert status == 200
    assert payload["ready"] is True

    service.graphiti_client = broken_client
    status, payload = asyncio.run(health_status())
    assert status == 503
    assert payload["error"] == "graphiti_unavailable"
    assert "falkor unavailable" in payload["message"]
finally:
    service.graphiti_client = original_graphiti_client
    for key, value in original_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

print("memory-service-check passed")
