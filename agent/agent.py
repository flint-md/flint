"""
Flint AI Agent — Local Python Agent with Ollama + Web Search + Note Memory
Runs on http://localhost:5100
"""

import sys
import os

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import json
import time
import threading
import requests
from flask import Flask, request, Response, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins="*")

OLLAMA_URL = "http://127.0.0.1:11434"
AGENT_PORT = 5100



# ── Health Check ──────────────────────────────────────────────

@app.route("/status", methods=["GET"])
def status():
    """Check if Ollama is running"""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=1)
        if r.ok:
            data = r.json()
            models = [m["name"] for m in data.get("models", [])]
            return jsonify({"status": "connected", "models": models, "agent": "flint"})
        return jsonify({"status": "disconnected", "models": [], "agent": "flint"})
    except Exception:
        return jsonify({"status": "disconnected", "models": [], "agent": "flint"})


@app.route("/models", methods=["GET"])
def get_models():
    """List available Ollama models"""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=1)
        if r.ok:
            data = r.json()
            return jsonify({"models": [m["name"] for m in data.get("models", [])]})
        return jsonify({"models": []})
    except Exception:
        return jsonify({"models": []})


# ── Offline Enforcement ───────────────────────────────────────
# Internet access is strictly disabled for privacy and vault-only context.


def is_note_edit_request(query):
    q = query.lower()
    keywords = [
        "rename note", "rename this note", "change note", "edit note", "update note",
        "modify note", "fix note", "rewrite note", "append to note", "replace in note",
        "create note", "add note", "delete note", "remove note", "make this note",
    ]
    return any(kw in q for kw in keywords)


def extract_json_object(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except Exception:
        import re
        match = re.search(r'\{.*\}', text, re.S)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except Exception:
            return None


def summarize_actions(actions):
    if not actions:
        return "I reviewed your request, but I couldn't identify a safe note change."
    parts = []
    for action in actions[:3]:
        action_type = action.get("type", "")
        if action_type == "rename_note":
            parts.append(f'Renamed the note to "{action.get("title", "")}"')
        elif action_type == "update_note":
            parts.append("Updated the selected note content")
        elif action_type == "create_note":
            parts.append(f'Created a new note titled "{action.get("title", "Untitled")}"')
        elif action_type == "delete_note":
            parts.append("Deleted the selected note")
    if not parts:
        return "I reviewed your request, but I couldn't identify a safe note change."
    return "; ".join(parts) + "."


def concise_note_reply(notes, query, active_note_id, memory, max_notes=5):
    note_map = {n["id"]: n for n in notes}
    active_note = note_map.get(active_note_id)
    q = query.lower().strip()

    if not notes:
      return "Your vault is empty. Create a note to get started."

    if any(kw in q for kw in ["summarize", "summary", "what are my notes about", "main topics"]):
        titles = [n["title"] for n in notes[:max_notes]]
        return "Main topics: " + ", ".join(titles) + ("." if titles else "")

    if active_note:
        return f'About "{active_note["title"]}": {active_note["content"].splitlines()[0][:140]}'

    top_titles = [n["title"] for n in notes[:max_notes]]
    return "Relevant notes: " + ", ".join(top_titles) + "."


def build_concise_system_prompt(system_prompt, memory):
    if memory and memory != "No notes available in the vault yet.":
        return (
            f"{system_prompt}\n\n"
            f"{memory}\n\n"
            f"IMPORTANT RULES:\n"
            f"1. You must answer the user's question primarily using the provided Flint Vault Knowledge Base and Note Connections.\n"
            f"2. If the vault does not contain enough relevant information to answer the question, you must clearly state that the local notes do not contain the answer, rather than inventing facts.\n"
            f"3. You may use general knowledge to supplement the answer, but you must clearly distinguish between what was found in the user's notes versus general knowledge."
        )
    return (
        f"{system_prompt}\n\n"
        f"The user's note vault is empty. Please answer the user's question clearly and concisely, but inform them that they have no local notes to search."
    )


def build_edit_prompt(system_prompt, memory, query):
    return (
        f"{system_prompt}\n\n"
        f"You are in note-edit mode. Return ONLY valid JSON with this schema:\n"
        f'{{"summary":"short user-facing summary","actions":[{{"type":"update_note|rename_note|create_note|delete_note","target":"active|id|title","noteId":"optional","matchTitle":"optional","title":"optional","content":"optional"}}]}}\n\n'
        f"Rules:\n"
        f"- Keep the summary short and factual.\n"
        f"- Only include actions you are confident about.\n"
        f"- If unsure, return {{\"summary\":\"I could not identify a safe note change.\",\"actions\":[]}}.\n"
        f"- Do not add markdown fences or extra text.\n\n"
        f"{memory}\n\nQuery: {query}"
    )


def stream_text_chunks(text, chunk_size=3):
    """Yield SSE chunks for plain text responses."""
    for i in range(0, len(text), chunk_size):
        chunk = text[i:i + chunk_size]
        yield f"data: {json.dumps({'content': chunk})}\n\n"


def resolve_openai_base_url(provider, api_base_url):
    """Resolve chat completion endpoint for OpenAI-compatible APIs."""
    if provider == "openai":
        base = (api_base_url or "https://api.openai.com/v1").rstrip("/")
    else:
        base = (api_base_url or "").rstrip("/")
        if not base:
            raise ValueError("API base URL is required for openai-compatible provider")

    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def call_openai_compatible(provider, api_key, api_base_url, model, messages, temperature, max_tokens=180):
    """Call OpenAI/OpenAI-compatible chat completion API."""
    endpoint = resolve_openai_base_url(provider, api_base_url)
    if not model:
        model = "gpt-4o-mini" if provider == "openai" else ""
    if not model:
        raise ValueError("Model is required for openai-compatible provider")

    resp = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max(32, int(max_tokens)),
        },
        timeout=120,
    )
    if not resp.ok:
        detail = resp.text[:500]
        raise RuntimeError(f"Provider API error ({resp.status_code}): {detail}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("Provider API returned no choices")

    content = choices[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return str(content or "")


def call_gemini(api_key, model, system_content, history, query, temperature, max_tokens=180):
    """Call Gemini generateContent API."""
    selected_model = model or "gemini-1.5-flash"
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{selected_model}:generateContent?key={api_key}"

    contents = []
    for h in history[-10:]:
        role = h.get("role", "user")
        text = h.get("content", "")
        if not text:
            continue
        contents.append({
            "role": "model" if role == "assistant" else "user",
            "parts": [{"text": text}],
        })
    contents.append({"role": "user", "parts": [{"text": query}]})

    resp = requests.post(
        endpoint,
        headers={"Content-Type": "application/json"},
        json={
            "systemInstruction": {"parts": [{"text": system_content}]},
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max(32, int(max_tokens)),
            },
        },
        timeout=120,
    )
    if not resp.ok:
        detail = resp.text[:500]
        raise RuntimeError(f"Gemini API error ({resp.status_code}): {detail}")

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise RuntimeError("Gemini API returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "\n".join(part.get("text", "") for part in parts if isinstance(part, dict))
    return text or ""


def call_claude(api_key, model, system_content, history, query, temperature, max_tokens=180):
    """Call Claude messages API."""
    selected_model = model or "claude-3-haiku-20240307"
    endpoint = "https://api.anthropic.com/v1/messages"

    messages = []
    for h in history[-10:]:
        role = h.get("role", "user")
        text = h.get("content", "")
        if not text:
            continue
        messages.append({
            "role": "assistant" if role == "assistant" else "user",
            "content": text
        })
    messages.append({"role": "user", "content": query})

    resp = requests.post(
        endpoint,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        },
        json={
            "model": selected_model,
            "system": system_content,
            "messages": messages,
            "max_tokens": max(32, int(max_tokens)),
            "temperature": temperature
        },
        timeout=120
    )
    if not resp.ok:
        detail = resp.text[:500]
        raise RuntimeError(f"Claude API error ({resp.status_code}): {detail}")

    data = resp.json()
    content_blocks = data.get("content", [])
    text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
    return text or ""




# ── Memory Builder ────────────────────────────────────────────

def build_memory(notes, active_note_id, query, max_notes=10):
    """Build memory context from notes and their graph connections"""
    if not notes:
        return "No notes available in the vault yet."

    # Build graph
    graph = {}
    note_map = {}
    title_to_id = {}
    for n in notes:
        nid = n.get("id", "")
        title = n.get("title", "")
        content = n.get("content", "")
        note_map[nid] = {"title": title, "content": content}
        title_to_id[title.lower()] = nid
        graph[nid] = set()

    # Extract [[wiki links]]
    import re
    for n in notes:
        nid = n.get("id", "")
        content = n.get("content", "")
        for m in re.finditer(r'\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]', content):
            link_name = m.group(1).strip().lower()
            other_id = title_to_id.get(link_name)
            if other_id and other_id != nid:
                graph[nid].add(other_id)
                graph[other_id].add(nid)

    # Score notes by relevance
    scores = {}
    query_lower = query.lower()
    query_words = [w for w in query_lower.split() if len(w) > 2]

    for nid, ndata in note_map.items():
        score = 0
        title_lower = ndata["title"].lower()
        content_lower = ndata["content"].lower()

        # Title match
        if query_lower in title_lower:
            score += 20

        # Word matches
        for w in query_words:
            if w in title_lower:
                score += 8
            count = content_lower.count(w)
            if count > 0:
                score += min(count * 2, 12)

        # Active note bonus
        if nid == active_note_id:
            score += 15

        # Connection to active note
        if active_note_id and active_note_id in graph.get(nid, set()):
            score += 8

        # Graph centrality
        centrality = len(graph.get(nid, set()))
        score += min(centrality * 1.5, 10)

        if score > 0:
            scores[nid] = score

    # Sort by score and take top notes
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:max_notes]
    selected_ids = set([nid for nid, _ in ranked])

    # Expand to 1-hop neighbors
    for nid in list(selected_ids):
        for conn_id in graph.get(nid, set()):
            selected_ids.add(conn_id)

    # Build context string
    lines = []
    lines.append("=== YOUR MEMORY (Flint Vault Knowledge Base) ===")
    lines.append(f"Total notes in vault: {len(notes)}")
    lines.append("")

    # Connection map
    lines.append("=== MEMORY MAP (Note Connections) ===")
    
    # Only include graph connections for relevant notes to avoid blowing up context
    map_nodes = set(selected_ids)
    if active_note_id:
        map_nodes.add(active_note_id)
        
    for nid in sorted(map_nodes, key=lambda x: len(graph.get(x, set())), reverse=True):
        if graph.get(nid) and nid in note_map:
            conn_names = [note_map[cid]["title"] for cid in graph[nid] if cid in note_map]
            if conn_names:
                quoted_conn_names = [f'"{cn}"' for cn in conn_names]
                lines.append(f'"{note_map[nid]["title"]}" <-> {", ".join(quoted_conn_names)}')
    lines.append("")

    # Active note
    if active_note_id and active_note_id in note_map:
        adata = note_map[active_note_id]
        neighbors = [note_map[cid]["title"] for cid in graph.get(active_note_id, set()) if cid in note_map]
        lines.append("=== CURRENTLY OPEN NOTE ===")
        lines.append(f'Title: "{adata["title"]}"')
        if neighbors:
            lines.append(f"Connected to: {', '.join(neighbors)}")
        content = adata["content"]
        lines.append(content[:600] + ("\n...[truncated]" if len(content) > 600 else ""))
        lines.append("")

    # Related notes
    lines.append("=== RELATED MEMORIES ===")
    for nid in list(selected_ids)[:max_notes + 5]:
        if nid == active_note_id:
            continue
        if nid not in note_map:
            continue
        ndata = note_map[nid]
        neighbors = [note_map[cid]["title"] for cid in graph.get(nid, set()) if cid in note_map]
        lines.append(f'\n--- "{ndata["title"]}" ---')
        if neighbors:
            lines.append(f"Connected to: {', '.join(neighbors)}")
        content = ndata["content"]
        lines.append(content[:300] + ("\n...[truncated]" if len(content) > 300 else ""))

    return "\n".join(lines)


# ── Built-in Fallback ─────────────────────────────────────────

def builtin_response(query, notes, active_note_id):
    """Built-in response when Ollama is not available"""
    import re as regex

    q = query.lower().strip()
    note_map = {n["id"]: n for n in notes}
    title_to_id = {n["title"].lower(): n["id"] for n in notes}
    graph = {}
    for n in notes:
        graph[n["id"]] = set()
    for n in notes:
        for m in regex.finditer(r'\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]', n.get("content", "")):
            link_name = m.group(1).strip().lower()
            other_id = title_to_id.get(link_name)
            if other_id and other_id != n["id"]:
                graph[n["id"]].add(other_id)
                graph[other_id].add(n["id"])

    active_note = note_map.get(active_note_id)

    if regex.match(r'^(hi|hello|hey|yo|good\s+(morning|afternoon|evening))\b', q):
        if active_note:
            return f'Hi. You are in "{active_note["title"]}". Ask me to summarize it, rename it, or update it.'
        return 'Hi. Ask me to summarize notes, find links, rename a note, or update content.'

    if q in ("reply", "replay") or "reply to" in q:
        if active_note:
            return f'I am ready to work on "{active_note["title"]}". Tell me the change you want.'
        return 'Tell me which note to work on.'

    if q in ("help", "what can you do", "what can you", "?"):
        return 'I can summarize notes, list connections, find tags, rename notes, update note content, create notes, and delete notes.'

    if len(q) <= 24 and not regex.match(r'^(summarize|summary|list|show|find|search|rename|update|edit|create|delete|remove|add|what|how)\b', q):
        if active_note:
            return f'Ask me to summarize, edit, rename, or find links in "{active_note["title"]}".'
        return 'Ask me to summarize, edit, rename, or find links in your notes.'

    # List notes
    if any(kw in q for kw in ["list", "show", "all note"]):
        if "note" in q or "all" in q or "everything" in q:
            if not notes:
                return "Your vault is empty. Create some notes to get started!"
            resp = f'You have {len(notes)} notes in your vault. Top notes:\n'
            ranked = sorted(notes, key=lambda n: len(graph.get(n["id"], set())), reverse=True)
            for n in ranked[:8]:
                conns = len(graph.get(n["id"], set()))
                resp += f"- {n['title']} ({conns} connection{'s' if conns != 1 else ''})\n"
            total_conns = sum(len(v) for v in graph.values()) // 2
            resp += f"Total connections: {total_conns}"
            return resp

    # Connections
    if any(kw in q for kw in ["connection", "link", "graph", "connect"]):
        connected = [(nid, conns) for nid, conns in graph.items() if len(conns) > 0]
        connected.sort(key=lambda x: len(x[1]), reverse=True)
        if not connected:
            return "No connections found. Use `[[Note Name]]` syntax to link notes together."
        resp = f'{len(connected)} notes have connections. Top links:\n'
        for nid, conns in connected[:8]:
            names = [note_map[cid]["title"] for cid in conns if cid in note_map]
            resp += f'- {note_map[nid]["title"]}: {", ".join(names)}\n'
        return resp

    # Tags
    if "tag" in q:
        all_tags = {}
        for n in notes:
            for t in regex.finditer(r'#(\w[\w-]*)', n.get("content", "")):
                tag = t.group(1)
                all_tags.setdefault(tag, []).append(n["title"])
        if not all_tags:
            return "No tags found. Use `#tag` syntax to tag your notes."
        resp = f'{len(all_tags)} tags found. Top tags:\n'
        for tag, note_list in list(all_tags.items())[:8]:
            resp += f'- #{tag} ({len(note_list)} note{"s" if len(note_list) > 1 else ""}): {", ".join(note_list)}\n'
        return resp

    # Help
    if "help" in q or "what can you" in q:
        return 'I can summarize notes, list connections, find tags, rename notes, update note content, create notes, and delete notes.'

    # Search notes
    search_words = [w for w in regex.sub(r'[?.,!]', '', q).split() if len(w) > 2]
    matched = []
    for n in notes:
        content = (n["title"] + " " + n.get("content", "")).lower()
        if any(w in content for w in search_words):
            matched.append(n)

    if matched:
        resp = ""
        if active_note:
            resp += f'Viewing "{active_note["title"]}". Related notes:\n'
        else:
            resp += "Related notes:\n"
        for n in matched[:5]:
            conns = [note_map[cid]["title"] for cid in graph.get(n["id"], set()) if cid in note_map]
            linked_suffix = f" (linked to {', '.join(conns)})" if conns else ""
            resp += f"- {n['title']}{linked_suffix}\n"
            content = n.get("content", "")
            paragraphs = content.split("\n\n")
            relevant = [p for p in paragraphs if any(w in p.lower() for w in search_words)]
            if relevant:
                snippet = relevant[0]
            else:
                snippet = paragraphs[0] if paragraphs else ""
            resp += f"  {snippet[:160]}{'...' if len(snippet) > 160 else ''}\n"
        if len(matched) > 5:
            resp += f"...and {len(matched) - 5} more related notes.\n"
        total_conns = sum(len(v) for v in graph.values()) // 2
        resp += f"Found {len(matched)} relevant notes across {len(notes)} notes with {total_conns} connections."
        return resp

    # Default
    resp = f'I could not find a direct match for "{query}".\n'
    if notes:
        resp += "Try one of these notes:\n"
        for n in notes[:6]:
            resp += f"- {n['title']}\n"
        if len(notes) > 6:
            resp += f"...and {len(notes) - 6} more\n"
    resp += "Ask me to summarize, edit, rename, or find links in your notes."
    return resp


# ── Chat Endpoint (Streaming) ─────────────────────────────────

@app.route("/chat", methods=["POST"])
def chat():
    """Main chat endpoint — streams response from Ollama or uses built-in"""
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    query = data.get("query", "")
    notes = data.get("notes", [])
    active_note_id = data.get("activeNoteId", None)
    settings = data.get("settings", {})
    history = data.get("history", [])

    model = settings.get("model", "")
    provider = str(settings.get("provider", "ollama") or "ollama").strip().lower()
    ollama_url = settings.get("ollamaUrl", OLLAMA_URL)
    api_key = str(settings.get("apiKey", "") or "").strip()
    api_base_url = str(settings.get("apiBaseUrl", "") or "").strip()
    local_model_path = str(settings.get("localModelPath", "") or "").strip()
    local_model_context = int(settings.get("localModelContext", 2048) or 2048)
    local_model_threads = int(settings.get("localModelThreads", 4) or 4)
    max_output_tokens = int(settings.get("maxOutputTokens", 180) or 180)
    temperature = settings.get("temperature", 0.7)
    max_context = settings.get("maxContextNotes", 10)
    system_prompt = settings.get("systemPrompt", "You are Flint AI, a helpful assistant with access to the user's note vault.")

    # Build memory
    memory = build_memory(notes, active_note_id, query, max_context)

    edit_request = is_note_edit_request(query)

    # If no model, use built-in
    if provider == "ollama" and (not model or not model.strip()):
        response_text = concise_note_reply(notes, query, active_note_id, memory, max_context)
        if edit_request:
            response_text = "I can suggest note changes, but Ollama is not configured."

        def stream_builtin():
            for i in range(0, len(response_text), 3):
                chunk = response_text[i:i+3]
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True, 'usedOllama': False})}\n\n"

        return Response(stream_builtin(), mimetype="text/event-stream")

    # Use Ollama / external provider
    system_content = build_edit_prompt(system_prompt, memory, query) if edit_request else build_concise_system_prompt(system_prompt, memory)

    active_note = None
    for n in notes:
        if n.get("id") == active_note_id:
            active_note = n
            break
    system_content += f'\n\nCurrent active note: "{active_note["title"] if active_note else "None"}"'

    messages = [{"role": "system", "content": system_content}]
    for h in history[-10:]:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    messages.append({"role": "user", "content": query})

    if edit_request:
        def stream_edit_plan(response_text, used_ollama):
            payload = extract_json_object(response_text)
            if not payload:
                summary = "I could not confidently identify a safe note change."
                actions = []
            else:
                actions = payload.get("actions", []) if isinstance(payload, dict) else []
                summary = payload.get("summary", "") if isinstance(payload, dict) else ""
                if not summary:
                    summary = summarize_actions(actions)
            if actions:
                summary += f"\n\nApplied {len(actions)} change{'s' if len(actions) != 1 else ''}."
            for chunk in stream_text_chunks(summary, 3):
                yield chunk
            yield f"data: {json.dumps({'done': True, 'usedOllama': used_ollama, 'actions': actions})}\n\n"

        try:
            if provider == "ollama":
                response = requests.post(
                    f"{ollama_url}/api/chat",
                    json={
                        "model": model,
                        "messages": messages,
                        "stream": False,
                        "options": {"temperature": min(temperature, 0.3), "num_ctx": 8192, "top_p": 0.8},
                    },
                    timeout=120,
                )
                if not response.ok:
                    raise RuntimeError(f"Ollama error ({response.status_code})")
                data = response.json()
                text = data.get("message", {}).get("content", "")
                return Response(stream_edit_plan(text, True), mimetype="text/event-stream")

            if provider in ("openai", "openai-compatible"):
                text = call_openai_compatible(provider, api_key, api_base_url, model, messages, min(temperature, 0.3), max_output_tokens)
                return Response(stream_edit_plan(text, True), mimetype="text/event-stream")

            if provider == "gemini":
                text = call_gemini(api_key, model, system_content, history, query, min(temperature, 0.3), max_output_tokens)
                return Response(stream_edit_plan(text, True), mimetype="text/event-stream")

            if provider == "claude":
                text = call_claude(api_key, model, system_content, history, query, min(temperature, 0.3), max_output_tokens)
                return Response(stream_edit_plan(text, True), mimetype="text/event-stream")
        except Exception as e:
            fallback = concise_note_reply(notes, query, active_note_id, memory, max_context)
            fallback += f"\n\n*Unable to prepare note edits: {str(e)}*"

            def stream_edit_failure():
                for chunk in stream_text_chunks(fallback, 3):
                    yield chunk
                yield f"data: {json.dumps({'done': True, 'error': str(e), 'usedOllama': False, 'actions': []})}\n\n"

            return Response(stream_edit_failure(), mimetype="text/event-stream")

    if provider in ("openai", "openai-compatible", "gemini", "claude"):
        def stream_external():
            try:
                if not api_key:
                    fallback = concise_note_reply(notes, query, active_note_id, memory, max_context)
                    fallback += "\n\n*Missing API key. Add it in AI settings to use this provider.*"
                    for chunk in stream_text_chunks(fallback):
                        yield chunk
                    yield f"data: {json.dumps({'done': True, 'error': 'Missing API key', 'usedOllama': False})}\n\n"
                    return

                if provider in ("openai", "openai-compatible"):
                    response_text = call_openai_compatible(
                        provider=provider,
                        api_key=api_key,
                        api_base_url=api_base_url,
                        model=model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_output_tokens,
                    )
                elif provider == "gemini":
                    response_text = call_gemini(
                        api_key=api_key,
                        model=model,
                        system_content=system_content,
                        history=history,
                        query=query,
                        temperature=temperature,
                        max_tokens=max_output_tokens,
                    )
                elif provider == "claude":
                    response_text = call_claude(
                        api_key=api_key,
                        model=model,
                        system_content=system_content,
                        history=history,
                        query=query,
                        temperature=temperature,
                        max_tokens=max_output_tokens,
                    )
                else:
                    raise RuntimeError(f"Unsupported provider: {provider}")

                concise_text = response_text.strip() or concise_note_reply(notes, query, active_note_id, memory, max_context)
                for chunk in stream_text_chunks(concise_text):
                    yield chunk
                yield f"data: {json.dumps({'done': True, 'usedOllama': True})}\n\n"
            except Exception as e:
                fallback = concise_note_reply(notes, query, active_note_id, memory, max_context)
                fallback += f"\n\n*Provider request failed: {str(e)}*"
                for chunk in stream_text_chunks(fallback):
                    yield chunk
                yield f"data: {json.dumps({'done': True, 'error': str(e), 'usedOllama': False})}\n\n"

        return Response(stream_external(), mimetype="text/event-stream")


    def stream_ollama():
        try:
            resp = requests.post(
                f"{ollama_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "options": {
                        "temperature": temperature,
                        "num_ctx": 8192,
                        "num_predict": max_output_tokens,
                        "top_p": 0.9,
                    },
                },
                stream=True,
                timeout=180,
            )

            if not resp.ok:
                error_text = resp.text
                try:
                    error_json = json.loads(error_text)
                    err_msg = error_json.get("error", f"Ollama error ({resp.status_code})")
                except Exception:
                    err_msg = f"Ollama error ({resp.status_code})"

                if "not found" in err_msg or "model" in err_msg.lower():
                    err_msg = f'Model "{model}" not found. Run: `ollama pull {model}`'

                # Fall back to built-in
                fallback = concise_note_reply(notes, query, active_note_id, memory, max_context)
                for i in range(0, len(fallback), 3):
                    chunk = fallback[i:i+3]
                    yield f"data: {json.dumps({'content': chunk})}\n\n"
                yield f"data: {json.dumps({'done': True, 'error': err_msg, 'usedOllama': False})}\n\n"
                return

            full_content = ""
            for line in resp.iter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        content = chunk.get("message", {}).get("content", "")
                        if content:
                            full_content += content
                            yield f"data: {json.dumps({'content': content})}\n\n"
                        if chunk.get("done"):
                            yield f"data: {json.dumps({'done': True, 'usedOllama': True})}\n\n"
                            return
                    except json.JSONDecodeError:
                        continue

            # Stream ended without done=True
            yield f"data: {json.dumps({'done': True, 'usedOllama': True})}\n\n"

        except requests.exceptions.ConnectionError:
            # Ollama not running — fall back to built-in
            fallback = concise_note_reply(notes, query, active_note_id, memory, max_context)
            for i in range(0, len(fallback), 3):
                chunk = fallback[i:i+3]
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True, 'error': 'Ollama not running. Using built-in search.', 'usedOllama': False})}\n\n"

        except requests.exceptions.Timeout:
            yield f"data: {json.dumps({'done': True, 'error': 'Request timed out. Try a shorter query or faster model.'})}\n\n"

        except Exception as e:
            fallback = concise_note_reply(notes, query, active_note_id, memory, max_context)
            for i in range(0, len(fallback), 3):
                chunk = fallback[i:i+3]
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True, 'error': str(e), 'usedOllama': False})}\n\n"

    return Response(stream_ollama(), mimetype="text/event-stream")


# ── Start ─────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  Flint AI Agent")
    print("  Running on http://localhost:5100")
    print("=" * 50)

    # Check Ollama
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        if r.ok:
            models = [m["name"] for m in r.json().get("models", [])]
            print(f"  [OK] Ollama connected - {len(models)} model(s) available")
            for m in models:
                print(f"    - {m}")
        else:
            print("  [ERROR] Ollama not responding")
    except Exception:
        print("  [ERROR] Ollama not running - built-in AI will be used")
        print("    Install Ollama: https://ollama.ai")

    print("=" * 50)
    app.run(host="0.0.0.0", port=AGENT_PORT, debug=False, threaded=True)
