import asyncio
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

_graphiti = None
_indices_ready = False
_loop = None
YANDEX_AI_STUDIO_BASE_URL = "https://ai.api.cloud.yandex.net/v1"
YANDEX_EMBEDDING_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding"
YANDEX_DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash"
YANDEX_EMBEDDING_MODEL = "text-embeddings-v2-doc"
MEMORY_EVENT_KINDS = {"coding_habit", "weak_topic", "strong_topic", "response_preference", "project_reference"}
MEMORY_EVENT_SOURCES = {"manual", "task_run", "assistant_chat", "progress_pipeline", "studio_import"}


def event_to_episode(event):
    event_id = str(event.get("id") or "unknown")
    evidence = event.get("evidence") if isinstance(event.get("evidence"), dict) else {}
    group_id = str(evidence.get("projectId") or evidence.get("lessonId") or evidence.get("taskId") or "codelearn-local")
    return {
        "name": f"codelearn_memory_{event_id}",
        "body": json.dumps(event, ensure_ascii=False, sort_keys=True),
        "group_id": group_id,
        "reference_time": parse_reference_time(event.get("createdAt")),
    }


def parse_reference_time(value):
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


async def ingest_events(events):
    graphiti, episode_type = await graphiti_client()
    for event in events:
        episode = event_to_episode(event)
        await graphiti.add_episode(
            name=episode["name"],
            episode_body=episode["body"],
            source=episode_type.json,
            source_description="CodeLearnML accepted memory event",
            reference_time=episode["reference_time"],
            group_id=episode["group_id"],
        )
    return {"ok": True, "ingested": len(events)}


async def search_memory(query, group_id, limit):
    graphiti, _episode_type = await graphiti_client()
    results = await graphiti.search(query=query, group_ids=[group_id], num_results=limit)
    return {"ok": True, "results": [result_to_memory(result) for result in results]}


async def health_status():
    try:
        await graphiti_client()
    except GraphMemoryConfigError as exc:
        return 503, {
            "ok": False,
            "service": "codelearn-graph-memory",
            "ready": False,
            "error": str(exc),
        }
    except Exception as exc:
        return 503, {
            "ok": False,
            "service": "codelearn-graph-memory",
            "ready": False,
            "error": "graphiti_unavailable",
            "message": str(exc),
        }
    return 200, {"ok": True, "service": "codelearn-graph-memory", "ready": True, "provider": graphiti_provider()}


class GraphMemoryConfigError(RuntimeError):
    pass


def run_async(coro):
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
    return _loop.run_until_complete(coro)


def has_openai_graphiti_credentials():
    return bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_ADMIN_KEY"))


def has_yandex_graphiti_credentials():
    return bool(os.environ.get("YANDEX_AI_STUDIO_API_KEY") and os.environ.get("YANDEX_AI_STUDIO_FOLDER_ID"))


def graphiti_provider():
    requested = str(os.environ.get("GRAPHITI_LLM_PROVIDER") or "auto").strip().lower()
    if requested not in {"auto", "openai", "yandex"}:
        raise GraphMemoryConfigError("invalid_graphiti_provider")
    if requested == "yandex":
        return "yandex"
    if requested == "openai":
        return "openai"
    if has_yandex_graphiti_credentials():
        return "yandex"
    return "openai"


def has_graphiti_credentials():
    provider = graphiti_provider()
    if provider == "yandex":
        return has_yandex_graphiti_credentials()
    return has_openai_graphiti_credentials()


def yandex_model_uri(folder_id, model_name):
    model_name = str(model_name or "").strip()
    if model_name.startswith(("gpt://", "emb://")):
        return model_name
    return f"gpt://{folder_id}/{model_name}"


def yandex_embedding_uri(folder_id, model_name):
    model_name = str(model_name or "").strip()
    if model_name.startswith(("gpt://", "emb://")):
        return model_name.rstrip("/")
    return f"emb://{folder_id}/{model_name}"


def yandex_embedding_input(input_data):
    if isinstance(input_data, str):
        return input_data
    if isinstance(input_data, bytes):
        return input_data.decode("utf-8", errors="replace")
    try:
        return json.dumps(input_data, ensure_ascii=False)
    except TypeError:
        return str(input_data)


def yandex_graphiti_settings():
    api_key = os.environ.get("YANDEX_AI_STUDIO_API_KEY")
    folder_id = os.environ.get("YANDEX_AI_STUDIO_FOLDER_ID")
    if not api_key or not folder_id:
        raise GraphMemoryConfigError("missing_graph_memory_credentials")
    try:
        embedding_dim = int(os.environ.get("YANDEX_GRAPHITI_EMBEDDING_DIM") or "256")
        max_tokens = int(os.environ.get("YANDEX_GRAPHITI_MAX_TOKENS") or "4096")
    except ValueError as exc:
        raise GraphMemoryConfigError("invalid_yandex_graphiti_numeric_setting") from exc
    if embedding_dim <= 0:
        raise GraphMemoryConfigError("invalid_yandex_graphiti_embedding_dim")
    if max_tokens <= 0:
        raise GraphMemoryConfigError("invalid_yandex_graphiti_max_tokens")
    structured_output_mode = str(os.environ.get("GRAPHITI_STRUCTURED_OUTPUT_MODE") or "json_object").strip()
    if structured_output_mode not in {"json_schema", "json_object"}:
        raise GraphMemoryConfigError("invalid_graphiti_structured_output_mode")
    model = yandex_model_uri(folder_id, os.environ.get("YANDEX_GRAPHITI_MODEL") or YANDEX_DEEPSEEK_FLASH_MODEL)
    small_model = yandex_model_uri(folder_id, os.environ.get("YANDEX_GRAPHITI_SMALL_MODEL") or os.environ.get("YANDEX_GRAPHITI_MODEL") or YANDEX_DEEPSEEK_FLASH_MODEL)
    embedding_model = yandex_embedding_uri(folder_id, os.environ.get("YANDEX_GRAPHITI_EMBEDDING_MODEL") or YANDEX_EMBEDDING_MODEL)
    return {
        "api_key": api_key,
        "folder_id": folder_id,
        "base_url": os.environ.get("YANDEX_AI_STUDIO_BASE_URL") or YANDEX_AI_STUDIO_BASE_URL,
        "embedding_url": os.environ.get("YANDEX_GRAPHITI_EMBEDDING_URL") or YANDEX_EMBEDDING_URL,
        "model": model,
        "small_model": small_model,
        "embedding_model": embedding_model,
        "embedding_dim": embedding_dim,
        "max_tokens": max_tokens,
        "structured_output_mode": structured_output_mode,
    }


def result_to_memory(result):
    return {
        "uuid": str(getattr(result, "uuid", "")),
        "fact": str(getattr(result, "fact", "") or getattr(result, "name", "")),
        "validAt": str(getattr(result, "valid_at", "") or ""),
        "invalidAt": str(getattr(result, "invalid_at", "") or ""),
    }


def bounded_limit(value, default=8, maximum=50):
    try:
        limit = int(value or default)
    except (TypeError, ValueError):
        return default
    return max(1, min(limit, maximum))


def parse_json_bytes(raw):
    if not raw:
        return {}
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def validate_events(events):
    for event in events:
        if not isinstance(event, dict):
            return "invalid_memory_event"
        kind = str(event.get("kind") or "").strip()
        text = str(event.get("text") or "").strip()
        source = str(event.get("source") or "manual").strip()
        evidence = event.get("evidence")
        if not kind or not text:
            return "invalid_memory_event"
        if kind not in MEMORY_EVENT_KINDS:
            return "invalid_memory_event_kind"
        if source not in MEMORY_EVENT_SOURCES:
            return "invalid_memory_event_source"
        if evidence is not None and not isinstance(evidence, dict):
            return "invalid_memory_event_evidence"
        if len(text) > 5000 or len(json.dumps(evidence or {}, ensure_ascii=False)) > 20000:
            return "memory_event_too_large"
    return None


async def graphiti_client():
    global _graphiti, _indices_ready
    if _graphiti is None:
        provider = graphiti_provider()
        if not has_graphiti_credentials():
            raise GraphMemoryConfigError("missing_graph_memory_credentials")
        try:
            from graphiti_core import Graphiti
            from graphiti_core.driver.falkordb_driver import FalkorDriver
            from graphiti_core.nodes import EpisodeType
        except ImportError as exc:
            raise RuntimeError("graphiti_not_installed: install graphiti-core[falkordb]") from exc

        driver = FalkorDriver(
            host=os.environ.get("FALKORDB_HOST", "localhost"),
            port=int(os.environ.get("FALKORDB_PORT", "6379")),
            username=os.environ.get("FALKORDB_USERNAME") or None,
            password=os.environ.get("FALKORDB_PASSWORD") or None,
        )
        _graphiti = (build_graphiti(Graphiti, driver, provider), EpisodeType)
    graphiti, episode_type = _graphiti
    if not _indices_ready:
        await graphiti.build_indices_and_constraints()
        _indices_ready = True
    return graphiti, episode_type


def build_graphiti(Graphiti, driver, provider):
    if provider != "yandex":
        return Graphiti(graph_driver=driver)
    try:
        from openai import AsyncOpenAI
        from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
        from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
        from graphiti_core.llm_client.config import LLMConfig
        from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
    except ImportError as exc:
        raise RuntimeError("graphiti_openai_compatible_not_installed") from exc

    settings = yandex_graphiti_settings()
    llm_config = LLMConfig(
        api_key=settings["api_key"],
        model=settings["model"],
        small_model=settings["small_model"],
        base_url=settings["base_url"],
        max_tokens=settings["max_tokens"],
    )
    headers = {"x-folder-id": settings["folder_id"], "OpenAI-Project": settings["folder_id"]}
    client = AsyncOpenAI(
        api_key=settings["api_key"],
        base_url=settings["base_url"],
        project=settings["folder_id"],
        default_headers=headers,
    )
    class YandexOpenAIGenericClient(OpenAIGenericClient):
        async def _generate_response(self, messages, response_model=None, max_tokens=4096, model_size=None):
            openai_messages = []
            for message in messages:
                content = self._clean_input(message.content)
                if message.role == "user":
                    openai_messages.append({"role": "user", "content": content})
                elif message.role == "system":
                    openai_messages.append({"role": "system", "content": content})
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=openai_messages,
                temperature=self.temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            result = response.choices[0].message.content or ""
            if not result:
                raise RuntimeError("yandex_graphiti_empty_response")
            return json.loads(self._strip_code_fences(result))

    llm_client = YandexOpenAIGenericClient(
        config=llm_config,
        client=client,
        max_tokens=settings["max_tokens"],
        structured_output_mode=settings["structured_output_mode"],
    )
    class YandexOpenAIEmbedder(OpenAIEmbedder):
        async def create(self, input_data):
            return await asyncio.to_thread(yandex_text_embedding, settings, yandex_embedding_input(input_data))

        async def create_batch(self, input_data_list):
            embeddings = []
            for input_data in input_data_list:
                embeddings.append(await self.create(input_data))
            return embeddings

    embedder = YandexOpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key=settings["api_key"],
            base_url=settings["base_url"],
            embedding_model=settings["embedding_model"],
            embedding_dim=settings["embedding_dim"],
        ),
        client=client,
    )
    cross_encoder = OpenAIRerankerClient(config=llm_config, client=client)
    return Graphiti(graph_driver=driver, llm_client=llm_client, embedder=embedder, cross_encoder=cross_encoder)


def yandex_text_embedding(settings, text):
    payload = json.dumps(
        {
            "modelUri": settings["embedding_model"],
            "text": text,
            "dim": str(settings["embedding_dim"]),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        settings["embedding_url"],
        data=payload,
        headers={
            "Authorization": f"Api-Key {settings['api_key']}",
            "Content-Type": "application/json",
            "x-folder-id": settings["folder_id"],
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        message = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"yandex_embedding_failed: {message}") from exc
    embedding = body.get("embedding")
    if not isinstance(embedding, list):
        raise RuntimeError("yandex_embedding_invalid_response")
    return [float(value) for value in embedding[: settings["embedding_dim"]]]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/live":
            return self.send_json(200, {"ok": True, "service": "codelearn-graph-memory", "alive": True})
        if self.path == "/health":
            status, payload = run_async(health_status())
            return self.send_json(status, payload)
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path == "/memory/search":
            body = self.read_json()
            if body is None:
                return self.send_json(400, {"error": "invalid_json"})
            query = str(body.get("query") or "").strip()
            group_id = str(body.get("groupId") or "codelearn-local")
            limit = bounded_limit(body.get("limit"))
            if not query:
                return self.send_json(400, {"error": "empty_query"})
            try:
                result = run_async(search_memory(query, group_id, limit))
            except Exception as exc:
                return self.send_json(500, {"error": "graphiti_search_failed", "message": str(exc)})
            return self.send_json(200, result)
        if self.path != "/memory/events":
            return self.send_json(404, {"error": "not_found"})
        body = self.read_json()
        if body is None:
            return self.send_json(400, {"error": "invalid_json"})
        events = body.get("events")
        if not isinstance(events, list):
            return self.send_json(400, {"error": "invalid_events"})
        event_error = validate_events(events)
        if event_error:
            return self.send_json(400, {"error": event_error})
        try:
            result = run_async(ingest_events(events))
        except Exception as exc:
            return self.send_json(500, {"error": "graphiti_ingest_failed", "message": str(exc)})
        self.send_json(200, result)

    def log_message(self, _format, *_args):
        return

    def read_json(self):
        length = int(self.headers.get("content-length", "0") or "0")
        if length == 0:
            return {}
        return parse_json_bytes(self.rfile.read(length))

    def send_json(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main():
    host = os.environ.get("GRAPH_MEMORY_HOST", "0.0.0.0")
    port = int(os.environ.get("GRAPH_MEMORY_PORT", "8008"))
    HTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
