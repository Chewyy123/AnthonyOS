import os
import json
from datetime import date
from typing import List, Dict

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv(override=False)


def get_openai_client() -> OpenAI:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

    if not api_key:
        raise ValueError("OPENAI_API_KEY is missing.")

    return OpenAI(api_key=api_key)


def get_system_prompt(mode: str) -> str:
    normalized_mode = (mode or "").strip().lower()

    if normalized_mode == "life":
        return """
You are AnthonyOS Life, a practical life operating assistant for Anthony.

Your job is to help Anthony:
- plan his day realistically
- prioritize tasks
- create routines and schedules
- reduce overwhelm
- break goals into manageable actions
- give practical advice, not vague motivational fluff

Behavior rules:
- talk like a real assistant, not a rigid template machine
- be conversational when appropriate
- when structure helps, use sections such as PRIORITIES, PLAN, NEXT ACTIONS
- when the user is clearly having a back-and-forth conversation, respond naturally and build on prior context
- do not repeat the entire plan every turn unless needed
- be practical, grounded, and specific
"""

    if normalized_mode == "dev":
        return """
You are AnthonyOS Dev, a strong web development and coding assistant for Anthony.

Your job is to help Anthony:
- brainstorm web app ideas
- write and refactor code
- debug issues
- explain technical concepts clearly
- scaffold practical projects
- help him regain confidence and speed as a developer

Behavior rules:
- talk like a real senior dev assistant, not a rigid template machine
- be conversational when appropriate
- when structure helps, use sections such as GOAL, RECOMMENDATION, BREAKDOWN, NEXT STEPS
- when the user is clearly continuing a conversation, build on the prior context instead of restarting from scratch
- when code helps, provide clean code and explain only the important parts
- optimize for momentum and shipping
"""

    return """
You are AnthonyOS, a practical and conversational AI assistant for Anthony.
Be clear, helpful, and context-aware.
"""


def ask_ai(prompt: str, mode: str, history: List[Dict[str, str]]):
    client = get_openai_client()
    system_prompt = get_system_prompt(mode)

    messages = [{"role": "system", "content": system_prompt}]

    for item in history[-12:]:
        role = item.get("role", "")
        content = item.get("content", "")

        if role in ["user", "assistant"] and isinstance(content, str) and content.strip():
            messages.append(
                {
                    "role": role,
                    "content": content
                }
            )

    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=messages,
    )

    return response.choices[0].message.content


def generate_home_briefing(
    open_count: int,
    completed_count: int,
    total_tasks: int,
    overdue_count: int,
    due_soon_count: int,
    recent_conversation_count: int,
    top_tasks: List[Dict[str, str]],
):
    client = get_openai_client()

    system_prompt = """
You are AnthonyOS Home, an intelligent command-center briefing assistant for Anthony.

Your job:
- review the app state
- produce a short, genuinely useful daily briefing
- identify what matters most right now
- avoid generic fluff
- sound like a sharp personal operating system, not a corporate dashboard

Rules:
- keep the response concise but useful
- use 3 sections exactly:
OVERVIEW:
FOCUS:
NEXT MOVE:

Guidance:
- OVERVIEW should summarize the overall situation
- FOCUS should highlight what needs attention most
- NEXT MOVE should recommend the best immediate action
- pay special attention to overdue and due soon items
- reference priority when useful
- mention conversation activity when relevant
- do not invent deadlines, inbox items, or monitoring data that were not provided
"""

    user_prompt = f"""
Here is AnthonyOS app state:

Open tasks: {open_count}
Completed tasks: {completed_count}
Total saved tasks: {total_tasks}
Overdue tasks: {overdue_count}
Due soon tasks: {due_soon_count}
Conversation messages in current session: {recent_conversation_count}

Top tasks:
{top_tasks}
"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    return response.choices[0].message.content


def suggest_task_metadata(title: str, details: str, mode: str):
    client = get_openai_client()
    today = date.today()

    fallback = {
        "priority": "medium",
        "dueDate": "",
    }

    system_prompt = f"""
You are AnthonyOS task triage.

Your job is to suggest:
1. a priority: low, medium, or high
2. a due date in YYYY-MM-DD format, or empty string if no due date is warranted

Today's date is {today.isoformat()}.

Rules:
- Return JSON only
- Use exactly these keys: priority, dueDate
- priority must be one of: low, medium, high
- dueDate must be either "" or a valid YYYY-MM-DD date
- Do not invent extreme urgency unless the content clearly implies it
- Use higher priority for urgent, time-sensitive, blocked, or important next-step work
- Use due dates when the task sounds like something that should happen on a near timeline
- If uncertain, prefer medium priority and empty due date
"""

    user_prompt = f"""
Mode: {mode}

Task title:
{title}

Task details:
{details}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content
        parsed = json.loads(raw)

        priority = parsed.get("priority", "medium")
        due_date = parsed.get("dueDate", "")

        if priority not in {"low", "medium", "high"}:
            priority = "medium"

        if due_date and not isinstance(due_date, str):
            due_date = ""

        return {
            "priority": priority,
            "dueDate": due_date,
        }
    except Exception:
        return fallback


def generate_yahoo_inbox_briefing(unread_count: int, emails: List[Dict[str, str]]):
    client = get_openai_client()

    fallback = {
        "summary": "Your inbox was reviewed, but the structured classification failed. Try refreshing again.",
        "securityAlerts": [],
        "important": [],
        "actionNeeded": [],
        "likelySpamOrPromo": [],
    }

    system_prompt = """
You are AnthonyOS Inbox, an email triage assistant.

Your job:
- identify security-sensitive emails first
- identify which emails look important
- identify which emails likely need action or reply
- identify which emails look like spam, promotions, newsletters, or low-value messages
- avoid overclaiming
- be conservative: only mark something as a security alert if it clearly looks like a login alert,
  password reset, verification code, suspicious sign-in, device access, billing risk, fraud warning,
  account recovery, account lock, or other account-security event

Return JSON only with exactly these keys:
{
  "summary": "short summary",
  "securityAlerts": [
    {"subject": "...", "from": "...", "reason": "..."}
  ],
  "important": [
    {"subject": "...", "from": "...", "reason": "..."}
  ],
  "actionNeeded": [
    {"subject": "...", "from": "...", "reason": "..."}
  ],
  "likelySpamOrPromo": [
    {"subject": "...", "from": "...", "reason": "..."}
  ]
}

Rules:
- Every email should fit best in one bucket only
- securityAlerts should be highest-signal and low-volume
- important is for meaningful updates, transactions, personal or work-relevant messages
- actionNeeded is for things that likely require a reply, confirmation, payment, scheduling, or follow-up
- likelySpamOrPromo is for newsletters, marketing, obvious promotions, junk, or low-value updates
- Keep reasons short and useful
"""

    user_prompt = f"""
Unread count: {unread_count}

Inbox emails:
{emails}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )

        parsed = json.loads(response.choices[0].message.content)

        return {
            "summary": parsed.get("summary", ""),
            "securityAlerts": parsed.get("securityAlerts", []),
            "important": parsed.get("important", []),
            "actionNeeded": parsed.get("actionNeeded", []),
            "likelySpamOrPromo": parsed.get("likelySpamOrPromo", []),
        }
    except Exception:
        return fallback
