import asyncio
import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

_database = None
_graphs = {}
_loop = None

YANDEX_EMBEDDING_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding"
YANDEX_EMBEDDING_MODEL = "text-embeddings-v2-doc"
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small"
MEMORY_RELATION = "MEMORY_RELATION"
MEMORY_EVENT_KINDS = {"coding_habit", "weak_topic", "strong_topic", "skill_observation", "response_preference", "project_reference"}
MEMORY_EVENT_SOURCES = {"manual", "task_run", "assistant_chat", "progress_pipeline", "studio_import"}


class GraphMemoryConfigError(RuntimeError):
    pass


def event_to_record(event):
    evidence = event.get("evidence") if isinstance(event.get("evidence"), dict) else {}
    graph = evidence.get("graph") if isinstance(evidence.get("graph"), dict) else {}
    text = str(event.get("text") or "").strip()
    return {
        "uuid": str(event.get("id") or "unknown"),
        "subject": str(graph.get("subject") or "user").strip(),
        "relation": str(graph.get("relation") or event.get("kind") or "remembers").strip(),
        "object": str(graph.get("object") or text).strip(),
        "fact": text,
        "group_id": str(evidence.get("projectId") or evidence.get("lessonId") or evidence.get("taskId") or "codelearn-local"),
        "created_at": str(event.get("createdAt") or ""),
    }


async def ingest_events(events):
    for event in events:
        record = event_to_record(event)
        embedding = await text_embedding(record["fact"])
        graph = await graph_client(record["group_id"])
        await graph.query(
            """
            MERGE (s:MemoryEntity {name: $subject, group_id: $group_id})
            MERGE (o:MemoryEntity {name: $object, group_id: $group_id})
            MERGE (s)-[r:MEMORY_RELATION {uuid: $uuid}]->(o)
            SET r.relation = $relation,
                r.fact = $fact,
                r.fact_embedding = vecf32($embedding),
                r.group_id = $group_id,
                r.created_at = $created_at
            """,
            {**record, "embedding": embedding},
        )
    return {"ok": True, "ingested": len(events)}


async def search_memory(query, group_id, limit):
    embedding = await text_embedding(query)
    graph = await graph_client(group_id)
    result = await graph.ro_query(
        """
        MATCH ()-[r]->()
        WHERE r.fact_embedding IS NOT NULL AND r.fact IS NOT NULL
        WITH r, vec.cosineDistance(r.fact_embedding, vecf32($embedding)) AS distance
        RETURN coalesce(r.uuid, ''), coalesce(r.fact, ''), coalesce(r.created_at, ''), ''
        ORDER BY distance ASC
        LIMIT $limit
        """,
        {"embedding": embedding, "limit": limit},
    )
    return {"ok": True, "results": [row_to_memory(row) for row in result.result_set if str(row[1] or "").strip()]}


async def list_memory(group_id, limit):
    graph = await graph_client(group_id)
    result = await graph.ro_query(
        """
        MATCH (s)-[r]->(o)
        WHERE r.fact IS NOT NULL
        RETURN coalesce(r.uuid, ''), coalesce(s.name, ''), coalesce(r.relation, type(r)),
               coalesce(o.name, ''), coalesce(r.fact, ''), coalesce(r.created_at, '')
        ORDER BY r.created_at DESC
        LIMIT $limit
        """,
        {"limit": limit},
    )
    return {"ok": True, "groupId": group_id, "items": [row_to_graph_item(row) for row in result.result_set]}


async def health_status():
    try:
        if not has_embedding_credentials():
            raise GraphMemoryConfigError("missing_graph_memory_credentials")
        graph = await graph_client()
        await graph.query("RETURN 1")
    except GraphMemoryConfigError as exc:
        return 503, {"ok": False, "service": "codelearn-graph-memory", "ready": False, "error": str(exc)}
    except Exception as exc:
        return 503, {
            "ok": False,
            "service": "codelearn-graph-memory",
            "ready": False,
            "error": "graph_memory_unavailable",
            "message": str(exc),
        }
    return 200, {
        "ok": True,
        "service": "codelearn-graph-memory",
        "ready": True,
        "mode": "direct-triples",
        "provider": embedding_provider(),
    }


def run_async(coro):
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
    return _loop.run_until_complete(coro)


def openai_key():
    return os.environ.get("GRAPH_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_ADMIN_KEY")


def openrouter_key():
    return os.environ.get("GRAPH_OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY")


def yandex_credentials():
    return (
        os.environ.get("GRAPH_YANDEX_AI_STUDIO_API_KEY") or os.environ.get("YANDEX_AI_STUDIO_API_KEY"),
        os.environ.get("GRAPH_YANDEX_AI_STUDIO_FOLDER_ID") or os.environ.get("YANDEX_AI_STUDIO_FOLDER_ID"),
    )


def embedding_provider():
    # Old provider name is read only so an existing local UI configuration keeps working after upgrade.
    requested = str(os.environ.get("GRAPH_EMBEDDING_PROVIDER") or os.environ.get("GRAPHITI_LLM_PROVIDER") or "auto").strip().lower()
    if requested not in {"auto", "openai", "openrouter", "yandex"}:
        raise GraphMemoryConfigError("invalid_graph_embedding_provider")
    if requested != "auto":
        return requested
    yandex_key, yandex_folder = yandex_credentials()
    if yandex_key and yandex_folder:
        return "yandex"
    if openai_key():
        return "openai"
    if openrouter_key():
        return "openrouter"
    return "openai"


def has_embedding_credentials():
    provider = embedding_provider()
    if provider == "yandex":
        return all(yandex_credentials())
    return bool(openrouter_key() if provider == "openrouter" else openai_key())


def positive_env_integer(name, legacy_name, default):
    try:
        value = int(os.environ.get(name) or os.environ.get(legacy_name) or default)
    except ValueError as exc:
        raise GraphMemoryConfigError("invalid_graph_embedding_dim") from exc
    if value <= 0 or value > 8192:
        raise GraphMemoryConfigError("invalid_graph_embedding_dim")
    return value


def embedding_settings():
    provider = embedding_provider()
    if provider == "yandex":
        api_key, folder_id = yandex_credentials()
        if not api_key or not folder_id:
            raise GraphMemoryConfigError("missing_graph_memory_credentials")
        model_name = os.environ.get("GRAPH_EMBEDDING_MODEL") or os.environ.get("GRAPHITI_EMBEDDING_MODEL") or YANDEX_EMBEDDING_MODEL
        model = model_name if str(model_name).startswith("emb://") else f"emb://{folder_id}/{model_name}"
        return {
            "provider": provider,
            "api_key": api_key,
            "folder_id": folder_id,
            "base_url": os.environ.get("GRAPH_EMBEDDING_BASE_URL") or os.environ.get("GRAPHITI_EMBEDDING_BASE_URL") or YANDEX_EMBEDDING_URL,
            "model": model,
            "embedding_dim": positive_env_integer("GRAPH_EMBEDDING_DIM", "GRAPHITI_EMBEDDING_DIM", "256"),
        }
    api_key = openrouter_key() if provider == "openrouter" else openai_key()
    if not api_key:
        raise GraphMemoryConfigError("missing_graph_memory_credentials")
    default_base_url = OPENROUTER_BASE_URL if provider == "openrouter" else OPENAI_BASE_URL
    default_model = OPENROUTER_EMBEDDING_MODEL if provider == "openrouter" else OPENAI_EMBEDDING_MODEL
    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": os.environ.get("GRAPH_EMBEDDING_BASE_URL") or os.environ.get("GRAPHITI_EMBEDDING_BASE_URL") or default_base_url,
        "model": os.environ.get("GRAPH_EMBEDDING_MODEL") or os.environ.get("GRAPHITI_EMBEDDING_MODEL") or default_model,
        "embedding_dim": positive_env_integer("GRAPH_EMBEDDING_DIM", "GRAPHITI_EMBEDDING_DIM", "1536"),
    }


async def text_embedding(text):
    settings = embedding_settings()
    if settings["provider"] == "yandex":
        return await asyncio.to_thread(yandex_text_embedding, settings, yandex_embedding_input(text))
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings["api_key"], base_url=settings["base_url"])
    response = await client.embeddings.create(model=settings["model"], input=text)
    if not response.data or not isinstance(response.data[0].embedding, list):
        raise RuntimeError("embedding_invalid_response")
    return [float(value) for value in response.data[0].embedding]


def yandex_embedding_input(input_data):
    if isinstance(input_data, str):
        return input_data
    if isinstance(input_data, bytes):
        return input_data.decode("utf-8", errors="replace")
    try:
        return json.dumps(input_data, ensure_ascii=False)
    except TypeError:
        return str(input_data)


def yandex_text_embedding(settings, text):
    payload = json.dumps(
        {"modelUri": settings["model"], "text": text, "dim": str(settings["embedding_dim"])},
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        settings["base_url"],
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
    return [float(value) for value in embedding]


async def graph_client(group_id="codelearn-local"):
    global _database
    graph_name = str(group_id or "codelearn-local")
    if _database is None:
        from falkordb.asyncio import FalkorDB

        _database = FalkorDB(
            host=os.environ.get("FALKORDB_HOST", "localhost"),
            port=int(os.environ.get("FALKORDB_PORT", "6379")),
            username=os.environ.get("FALKORDB_USERNAME") or None,
            password=os.environ.get("FALKORDB_PASSWORD") or None,
        )
    if graph_name not in _graphs:
        _graphs[graph_name] = _database.select_graph(graph_name)
    return _graphs[graph_name]


def row_to_memory(row):
    return {
        "uuid": str(row[0] or ""),
        "fact": str(row[1] or "")[:1000],
        "validAt": str(row[2] or ""),
        "invalidAt": str(row[3] or ""),
    }


def row_to_graph_item(row):
    return {
        "uuid": str(row[0] or ""),
        "subject": str(row[1] or "")[:200],
        "relation": str(row[2] or "")[:120],
        "object": str(row[3] or "")[:500],
        "fact": str(row[4] or "")[:1000],
        "createdAt": str(row[5] or ""),
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
        graph = evidence.get("graph") if isinstance(evidence, dict) else None
        if graph is not None:
            if not isinstance(graph, dict) or set(graph) != {"subject", "relation", "object"}:
                return "invalid_memory_graph"
            if any(not isinstance(graph[key], str) or not graph[key].strip() for key in ("subject", "relation", "object")):
                return "invalid_memory_graph"
            if len(graph["subject"].strip()) > 200 or len(graph["relation"].strip()) > 120 or len(graph["object"].strip()) > 500:
                return "invalid_memory_graph"
        if contains_sensitive_data(text) or contains_sensitive_data(json.dumps(graph or {}, ensure_ascii=False)):
            return "sensitive_memory_data"
        if len(text) > 5000 or len(json.dumps(evidence or {}, ensure_ascii=False)) > 20000:
            return "memory_event_too_large"
    return None


def contains_sensitive_data(value):
    text = str(value or "")
    return bool(
        re.search(r"\b[a-z0-9_-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)[a-z0-9_-]*\s*[:=]\s*\S+", text, re.IGNORECASE)
        or re.search(r"\bsk-[a-z0-9_-]{12,}\b", text, re.IGNORECASE)
        or re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", text)
        or re.search(r"(?:\+?\d[\s().-]*){10,}", text)
    )


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/live":
            return self.send_json(200, {"ok": True, "service": "codelearn-graph-memory", "alive": True})
        if url.path == "/health":
            status, payload = run_async(health_status())
            return self.send_json(status, payload)
        if url.path == "/memory/items":
            query = parse_qs(url.query)
            group_id = str(query.get("groupId", ["codelearn-local"])[0] or "codelearn-local")
            limit = bounded_limit(query.get("limit", [100])[0], default=100, maximum=100)
            try:
                return self.send_json(200, run_async(list_memory(group_id, limit)))
            except Exception as exc:
                return self.send_json(500, {"error": "graph_memory_list_failed", "message": str(exc)})
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
                return self.send_json(500, {"error": "graph_memory_search_failed", "message": str(exc)})
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
            return self.send_json(500, {"error": "graph_memory_ingest_failed", "message": str(exc)})
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
