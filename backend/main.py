print("LOADING MAIN.PY WITH INBOX ROUTES")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Literal, Optional
import hashlib
import json
import re
from fastapi.middleware.cors import CORSMiddleware

from services.ai_service import (
    ask_ai,
    generate_home_briefing,
    suggest_task_metadata,
    generate_yahoo_inbox_briefing,
)
from services.yahoo_mail_service import summarize_yahoo_inbox

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class PromptRequest(BaseModel):
    prompt: str
    mode: str
    history: List[ChatMessage] = []


class HomeTask(BaseModel):
    title: str
    status: str
    createdAt: str
    priority: str
    dueDate: Optional[str] = None


class HomeBriefingRequest(BaseModel):
    openCount: int
    completedCount: int
    totalTasks: int
    overdueCount: int
    dueSoonCount: int
    recentConversationCount: int
    topTasks: List[HomeTask] = []


class TaskSuggestionRequest(BaseModel):
    title: str
    details: str
    mode: str


class EmailTaskCreateRequest(BaseModel):
    subject: str
    from_email: Optional[str] = None
    snippet: Optional[str] = ""
    body: Optional[str] = ""
    category: Optional[str] = None
    source_email_id: Optional[str] = None


class CaptureNoteRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    source: Optional[str] = "apple_notes_share"
    capturedAt: Optional[str] = None

    # iPhone Shortcut-friendly aliases / extra context
    noteTitle: Optional[str] = None
    noteContent: Optional[str] = None
    text: Optional[str] = None
    deviceName: Optional[str] = None
    sharedBy: Optional[str] = None
    createTasks: Optional[bool] = False


class ExtractTasksFromNoteRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    mode: Optional[str] = "Life"
    source: Optional[str] = "apple_notes_share"
    capturedAt: Optional[str] = None

    # iPhone Shortcut-friendly aliases
    noteTitle: Optional[str] = None
    noteContent: Optional[str] = None
    text: Optional[str] = None


def build_snapshot_id(title: str, content: str) -> str:
    return hashlib.sha256(f"{title.strip()}\n{content.strip()}".encode("utf-8")).hexdigest()[:16]


def resolve_note_title_content(payload) -> tuple[str, str]:
    title = (
        getattr(payload, "title", None)
        or getattr(payload, "noteTitle", None)
        or "Shared Note"
    )
    content = (
        getattr(payload, "content", None)
        or getattr(payload, "noteContent", None)
        or getattr(payload, "text", None)
        or ""
    )
    return str(title).strip() or "Shared Note", str(content).strip()


def build_note_summary(title: str, content: str) -> tuple[str, int]:
    line_count = len([line for line in content.splitlines() if line.strip()])

    summary_prompt = f"""Summarize this shared planning note for a dashboard. Keep it to 2-3 short sentences, human sounding, and call out anything time-sensitive.\n\nTitle: {title}\n\nNote:\n{content}"""

    try:
        summary = ask_ai(prompt=summary_prompt, mode="Life", history=[])
    except Exception:
        summary = f"Captured {line_count} non-empty lines from {title}."

    return summary.strip() if isinstance(summary, str) else "", line_count


def build_capture_note_response(request: CaptureNoteRequest):
    title, content = resolve_note_title_content(request)

    if not content:
        raise HTTPException(status_code=400, detail="Note content is required.")

    snapshot_id = build_snapshot_id(title, content)
    summary, line_count = build_note_summary(title, content)

    response = {
        "snapshotId": snapshot_id,
        "title": title,
        "content": content,
        "source": request.source or "apple_notes_share",
        "capturedAt": request.capturedAt,
        "lineCount": line_count,
        "summary": summary,
        "shortcutContext": {
            "deviceName": request.deviceName or "",
            "sharedBy": request.sharedBy or "",
        },
    }

    if request.createTasks:
        extracted = extract_tasks_core(
            title=title,
            content=content,
            mode="Life",
            source=request.source or "iphone_shortcut",
            captured_at=request.capturedAt,
        )
        response["tasks"] = extracted["tasks"]

    return response


def extract_tasks_core(title: str, content: str, mode: str = "Life", source: str = "apple_notes_share", captured_at: Optional[str] = None):
    ai_prompt = f"""You are extracting actionable tasks from a shared family planning note for a dashboard.\nReturn JSON only as an array. Each item must have: title, details, priority, dueDate, confidence.\nRules:\n- Include only actionable to-dos.\n- Skip headings, vague themes, and completed items.\n- priority must be low, medium, or high.\n- dueDate must be YYYY-MM-DD or an empty string.\n- confidence must be high, medium, or low.\n- details should be concise and mention useful source context from the note.\n\nTitle: {title}\nCaptured At: {captured_at or ''}\nSource: {source}\n\nNote:\n{content}"""

    parsed = None
    try:
        ai_response = ask_ai(prompt=ai_prompt, mode=mode or "Life", history=[])
        parsed = parse_json_from_ai_response(ai_response)
    except Exception:
        parsed = None

    if not isinstance(parsed, list):
        parsed = heuristic_note_tasks(title, content)

    cleaned = []
    for item in parsed:
        if not isinstance(item, dict):
            continue

        title_value = str(item.get("title", "")).strip()
        if not title_value:
            continue

        priority = str(item.get("priority", "medium")).lower().strip()
        if priority not in ["low", "medium", "high"]:
            priority = "medium"

        due_date = item.get("dueDate", "")
        if not isinstance(due_date, str):
            due_date = ""

        confidence = str(item.get("confidence", "medium")).lower().strip()
        if confidence not in ["low", "medium", "high"]:
            confidence = "medium"

        cleaned.append({
            "title": title_value,
            "details": str(item.get("details", "")).strip(),
            "priority": priority,
            "dueDate": due_date,
            "confidence": confidence,
        })

    return {
        "snapshotId": build_snapshot_id(title, content),
        "title": title,
        "tasks": cleaned,
    }


def parse_json_from_ai_response(raw: str):
    if not raw:
        return None

    text = raw.strip()
    fenced_match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced_match:
        text = fenced_match.group(1).strip()

    try:
        return json.loads(text)
    except Exception:
        pass

    bracket_match = re.search(r"(\[.*\]|\{.*\})", text, re.DOTALL)
    if bracket_match:
        try:
            return json.loads(bracket_match.group(1))
        except Exception:
            return None

    return None


def heuristic_note_tasks(title: str, content: str):
    tasks = []
    seen = set()

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        normalized = re.sub(r"^[\-\*•\d\.)\[\]xX\s]+", "", line).strip()
        if len(normalized) < 4:
            continue

        lowered = normalized.lower()
        if lowered in seen:
            continue

        if normalized.endswith(":"):
            continue

        if len(normalized.split()) > 20:
            continue

        seen.add(lowered)

        details = f"Source note: {title}\n\n{normalized}"
        try:
            metadata = suggest_task_metadata(title=normalized, details=details, mode="Life")
        except Exception:
            metadata = {}

        priority = metadata.get("priority", "medium")
        if priority not in ["low", "medium", "high"]:
            priority = "medium"

        due_date = metadata.get("dueDate", "")
        if not isinstance(due_date, str):
            due_date = ""

        tasks.append({
            "title": normalized,
            "details": details,
            "priority": priority,
            "dueDate": due_date,
            "confidence": "low",
        })

    return tasks[:12]


@app.post("/ask")
async def ask(request: PromptRequest):
    try:
        response = ask_ai(
            prompt=request.prompt,
            mode=request.mode,
            history=request.history,
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/home-briefing")
async def home_briefing(request: HomeBriefingRequest):
    try:
        briefing = generate_home_briefing(
            open_count=request.openCount,
            completed_count=request.completedCount,
            total_tasks=request.totalTasks,
            overdue_count=request.overdueCount,
            due_soon_count=request.dueSoonCount,
            recent_conversation_count=request.recentConversationCount,
            top_tasks=[task.model_dump() for task in request.topTasks],
        )
        return {"briefing": briefing}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/suggest-task-metadata")
async def suggest_metadata(request: TaskSuggestionRequest):
    try:
        result = suggest_task_metadata(
            title=request.title,
            details=request.details,
            mode=request.mode,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/inbox-summary")
async def inbox_summary():
    try:
        inbox_data = summarize_yahoo_inbox()

        briefing = generate_yahoo_inbox_briefing(
            unread_count=inbox_data["unreadCount"],
            emails=inbox_data["emails"],
        )

        return {
            "unreadCount": inbox_data.get("unreadCount", 0),
            "summary": briefing.get("summary", ""),
            "securityAlerts": briefing.get("securityAlerts", []),
            "important": briefing.get("important", []),
            "actionNeeded": briefing.get("actionNeeded", []),
            "likelySpamOrPromo": briefing.get("likelySpamOrPromo", []),
        }
    except Exception as e:
        return {
            "unreadCount": 0,
            "summary": "",
            "securityAlerts": [],
            "important": [],
            "actionNeeded": [],
            "likelySpamOrPromo": [],
            "error": str(e),
        }


@app.post("/create-task-from-email")
async def create_task_from_email(request: EmailTaskCreateRequest):
    try:
        title = request.subject.strip() or "Email Task"

        details_parts = []

        if request.from_email:
            details_parts.append(f"From: {request.from_email}")

        if request.category:
            details_parts.append(f"Category: {request.category}")

        content = (request.body or "").strip() or (request.snippet or "").strip()
        if content:
            details_parts.append("")
            details_parts.append(content)

        details = "\n".join(details_parts).strip()

        metadata = suggest_task_metadata(
            title=title,
            details=details,
            mode="Life",
        )

        priority = metadata.get("priority", "medium")
        if priority not in ["low", "medium", "high"]:
            priority = "medium"

        due_date = metadata.get("dueDate", "")
        if not isinstance(due_date, str):
            due_date = ""

        return {
            "title": title,
            "details": details,
            "priority": priority,
            "dueDate": due_date,
            "sourceEmailId": request.source_email_id,
            "category": request.category,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/capture-note")
async def capture_note(request: CaptureNoteRequest):
    try:
        title = request.title.strip() or "Shared Note"
        content = request.content.strip()

        if not content:
            raise HTTPException(status_code=400, detail="Note content is required.")

        snapshot_id = build_snapshot_id(title, content)
        line_count = len([line for line in content.splitlines() if line.strip()])

        summary_prompt = f"""Summarize this shared planning note for a dashboard. Keep it to 2-3 short sentences, human sounding, and call out anything time-sensitive.\n\nTitle: {title}\n\nNote:\n{content}"""

        try:
            summary = ask_ai(prompt=summary_prompt, mode="Life", history=[])
        except Exception:
            summary = f"Captured {line_count} non-empty lines from {title}."

        return {
            "snapshotId": snapshot_id,
            "title": title,
            "content": content,
            "source": request.source or "apple_notes_share",
            "capturedAt": request.capturedAt,
            "lineCount": line_count,
            "summary": summary.strip() if isinstance(summary, str) else "",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-tasks-from-note")
async def extract_tasks_from_note(request: ExtractTasksFromNoteRequest):
    try:
        title = request.title.strip() or "Shared Note"
        content = request.content.strip()

        if not content:
            raise HTTPException(status_code=400, detail="Note content is required.")

        ai_prompt = f"""You are extracting actionable tasks from a shared family planning note for a dashboard.\nReturn JSON only as an array. Each item must have: title, details, priority, dueDate, confidence.\nRules:\n- Include only actionable to-dos.\n- Skip headings, vague themes, and completed items.\n- priority must be low, medium, or high.\n- dueDate must be YYYY-MM-DD or an empty string.\n- confidence must be high, medium, or low.\n- details should be concise and mention useful source context from the note.\n\nTitle: {title}\nCaptured At: {request.capturedAt or ''}\nSource: {request.source or 'apple_notes_share'}\n\nNote:\n{content}"""

        parsed = None
        try:
            ai_response = ask_ai(prompt=ai_prompt, mode=request.mode or "Life", history=[])
            parsed = parse_json_from_ai_response(ai_response)
        except Exception:
            parsed = None

        if not isinstance(parsed, list):
            parsed = heuristic_note_tasks(title, content)

        cleaned = []
        for item in parsed:
            if not isinstance(item, dict):
                continue

            title_value = str(item.get("title", "")).strip()
            if not title_value:
                continue

            priority = str(item.get("priority", "medium")).lower().strip()
            if priority not in ["low", "medium", "high"]:
                priority = "medium"

            due_date = item.get("dueDate", "")
            if not isinstance(due_date, str):
                due_date = ""

            confidence = str(item.get("confidence", "medium")).lower().strip()
            if confidence not in ["low", "medium", "high"]:
                confidence = "medium"

            cleaned.append({
                "title": title_value,
                "details": str(item.get("details", "")).strip(),
                "priority": priority,
                "dueDate": due_date,
                "confidence": confidence,
            })

        return {
            "snapshotId": build_snapshot_id(title, content),
            "title": title,
            "tasks": cleaned,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


print("REGISTERED ROUTES:")
for route in app.routes:
    print(getattr(route, "path", "no-path"))