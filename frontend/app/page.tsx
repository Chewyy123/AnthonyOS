"use client";
import { useEffect, useMemo, useState } from "react";

type Mode = "Home" | "Life" | "Dev" | "Tasks";
type TaskStatus = "open" | "completed";
type TaskPriority = "low" | "medium" | "high";

type QuickAction = {
  title: string;
  description: string;
  prompt: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type TaskSource = "manual" | "chat" | "email" | "note";

type TaskItem = {
  id: string;
  title: string;
  details: string;
  createdAt: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  sourceType?: TaskSource;
  sourceId?: string;
  sourceLabel?: string;
};

type NoteSnapshot = {
  id: string;
  title: string;
  content: string;
  summary: string;
  capturedAt: string;
  lineCount: number;
  source: string;
};

type InboxEmail = {
  subject: string;
  from: string;
  reason: string;
};

type InboxData = {
  unreadCount: number;
  summary: string;
  securityAlerts: InboxEmail[];
  important: InboxEmail[];
  actionNeeded: InboxEmail[];
  likelySpamOrPromo: InboxEmail[];
};

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function isOverdue(dueDate: string) {
  if (!dueDate) return false;
  return dueDate < getTodayDateString();
}

function isDueSoon(dueDate: string) {
  if (!dueDate) return false;
  const today = new Date();
  const due = new Date(`${dueDate}T00:00:00`);
  const diffMs = due.getTime() - new Date(today.toDateString()).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 3;
}

function daysUntilDue(dueDate: string) {
  if (!dueDate) return null;
  const today = new Date();
  const due = new Date(`${dueDate}T00:00:00`);
  const diffMs = due.getTime() - new Date(today.toDateString()).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function priorityRank(priority: TaskPriority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function formatDateSafe(dateString: string) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDateSafe(dateString: string) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function normalizeInboxData(data: any): InboxData {
  return {
    unreadCount: typeof data?.unreadCount === "number" ? data.unreadCount : 0,
    summary: typeof data?.summary === "string" ? data.summary : "",
    securityAlerts: Array.isArray(data?.securityAlerts) ? data.securityAlerts : [],
    important: Array.isArray(data?.important) ? data.important : [],
    actionNeeded: Array.isArray(data?.actionNeeded) ? data.actionNeeded : [],
    likelySpamOrPromo: Array.isArray(data?.likelySpamOrPromo) ? data.likelySpamOrPromo : [],
  };
}

function cleanBriefingText(text: string) {
  return text
    .replace(/OVERVIEW:\s*/g, "")
    .replace(/FOCUS:\s*/g, "")
    .replace(/NEXT MOVE:\s*/g, "")
    .trim();
}

const shellCard =
  "rounded-2xl border border-white/10 bg-slate-950/45 backdrop-blur-xl shadow-[0_16px_60px_rgba(0,0,0,0.28)] transition duration-200";
const subtleCard =
  "rounded-2xl border border-white/10 bg-slate-950/35 backdrop-blur-xl shadow-[0_10px_36px_rgba(0,0,0,0.22)] transition duration-200";

function normalizeTask(task: TaskItem): TaskItem {
  return {
    ...task,
    priority: task.priority ?? "medium",
    dueDate: task.dueDate ?? "",
    sourceType: task.sourceType ?? "manual",
    sourceId: task.sourceId ?? "",
    sourceLabel: task.sourceLabel ?? "",
  };
}

function sourceBadgeClass(sourceType?: TaskSource) {
  if (sourceType === "email") return "border-cyan-500/20 bg-cyan-500/15 text-cyan-200";
  if (sourceType === "note") return "border-violet-500/20 bg-violet-500/15 text-violet-200";
  if (sourceType === "chat") return "border-emerald-500/20 bg-emerald-500/15 text-emerald-200";
  return "border-white/10 bg-white/[0.03] text-slate-300";
}

function sourceBadgeLabel(task: TaskItem) {
  if (task.sourceLabel?.trim()) return task.sourceLabel.trim();
  if (task.sourceType === "email") return "Email";
  if (task.sourceType === "note") return "Shared note";
  if (task.sourceType === "chat") return "Chat";
  return "Manual";
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("Home");
  const [prompt, setPrompt] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [taskFilter, setTaskFilter] = useState<"all" | "open" | "completed">("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskEditTitle, setTaskEditTitle] = useState("");
  const [taskEditDetails, setTaskEditDetails] = useState("");
  const [taskEditPriority, setTaskEditPriority] = useState<TaskPriority>("medium");
  const [taskEditDueDate, setTaskEditDueDate] = useState("");

  const [homeBriefing, setHomeBriefing] = useState("");
  const [homeBriefingLoading, setHomeBriefingLoading] = useState(false);
  const [homeBriefingRefreshKey, setHomeBriefingRefreshKey] = useState(0);

  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxData, setInboxData] = useState<InboxData | null>(null);

  const [notes, setNotes] = useState<NoteSnapshot[]>([]);
  const [noteTitle, setNoteTitle] = useState("Shared Family To-Dos");
  const [noteContent, setNoteContent] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteTaskLoading, setNoteTaskLoading] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const savedTasks = localStorage.getItem("anthonyos_tasks");
    if (savedTasks) {
      const parsed = JSON.parse(savedTasks) as TaskItem[];
      const normalized = parsed.map((task) => normalizeTask(task));
      setTasks(normalized);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("anthonyos_tasks", JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    const savedNotes = localStorage.getItem("anthonyos_notes");
    if (!savedNotes) return;

    try {
      const parsed = JSON.parse(savedNotes) as NoteSnapshot[];
      if (Array.isArray(parsed)) {
        setNotes(parsed);
      }
    } catch (error) {
      console.error("Failed to load notes", error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("anthonyos_notes", JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const quickActions = useMemo<Record<"Life" | "Dev", QuickAction[]>>(
    () => ({
      Life: [
        {
          title: "Plan the day",
          description: "Build a realistic plan without overloading it.",
          prompt: "Plan my day from noon to 8 PM with a productive work block, dinner, and gaming time.",
        },
        {
          title: "Weekly reset",
          description: "Turn the week into something manageable.",
          prompt: "Help me organize my week so I can handle life responsibilities and get back into web development.",
        },
        {
          title: "Get unstuck",
          description: "Figure out what deserves attention first.",
          prompt: "I feel overwhelmed. Help me figure out the top priorities and the first 3 things I should do.",
        },
        {
          title: "Build a routine",
          description: "Keep it simple enough to actually follow.",
          prompt: "Create a simple weekday routine for me that balances work, meals, exercise, and downtime.",
        },
      ],
      Dev: [
        {
          title: "Find a project",
          description: "Pick something practical and worth shipping.",
          prompt: "Give me a side-project dashboard app idea I could build to get back into web development.",
        },
        {
          title: "Sketch a page",
          description: "Outline structure and the right sections quickly.",
          prompt: "Create a landing page structure for a fantasy sports brand with sections and CTA ideas.",
        },
        {
          title: "Debug with me",
          description: "Troubleshoot cleanly without losing momentum.",
          prompt: "Help me debug a local web app that has a frontend, backend, and API integration.",
        },
        {
          title: "Shape the app",
          description: "Plan the stack and file structure clearly.",
          prompt: "Help me plan the architecture for a personal AI dashboard app using Next.js and FastAPI.",
        },
      ],
    }),
    []
  );

  const filteredTasks = useMemo(() => {
    if (taskFilter === "all") return tasks;
    return tasks.filter((task) => task.status === taskFilter);
  }, [tasks, taskFilter]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === "completed"), [tasks]);

  const prioritizedOpenTasks = useMemo(() => {
    return [...openTasks].sort((a, b) => {
      const aOverdue = isOverdue(a.dueDate) ? 1 : 0;
      const bOverdue = isOverdue(b.dueDate) ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;

      const aSoon = isDueSoon(a.dueDate) ? 1 : 0;
      const bSoon = isDueSoon(b.dueDate) ? 1 : 0;
      if (aSoon !== bSoon) return bSoon - aSoon;

      const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDiff !== 0) return priorityDiff;

      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });
  }, [openTasks]);

  const openCount = openTasks.length;
  const completedCount = completedTasks.length;
  const overdueCount = openTasks.filter((task) => isOverdue(task.dueDate)).length;
  const dueSoonCount = openTasks.filter((task) => isDueSoon(task.dueDate)).length;
  const securityAlertCount = inboxData?.securityAlerts?.length ?? 0;
  const latestNote = notes[0] ?? null;

  const latestAssistantMessage =
    [...messages].reverse().find((msg) => msg.role === "assistant")?.content ?? "";

  const topTasks = useMemo(() => prioritizedOpenTasks.slice(0, 3), [prioritizedOpenTasks]);

  const plannerColumns = useMemo(() => {
    const overdue = prioritizedOpenTasks.filter((task) => task.dueDate && isOverdue(task.dueDate));
    const today = prioritizedOpenTasks.filter((task) => {
      const days = daysUntilDue(task.dueDate);
      return days === 0;
    });
    const tomorrow = prioritizedOpenTasks.filter((task) => {
      const days = daysUntilDue(task.dueDate);
      return days === 1;
    });
    const thisWeek = prioritizedOpenTasks.filter((task) => {
      const days = daysUntilDue(task.dueDate);
      return days !== null && days >= 2 && days <= 7;
    });
    const later = prioritizedOpenTasks.filter((task) => {
      const days = daysUntilDue(task.dueDate);
      return days !== null && days > 7;
    });
    const noDate = prioritizedOpenTasks.filter((task) => !task.dueDate);

    return [
      {
        key: "overdue",
        title: "Overdue",
        subtitle: "Needs attention now",
        emptyLabel: "Clear here.",
        tasks: overdue,
        headerClass: "border-red-500/20 bg-red-500/10 text-red-200",
      },
      {
        key: "today",
        title: "Today",
        subtitle: "Focus lane",
        emptyLabel: "Nothing due today.",
        tasks: today,
        headerClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
      },
      {
        key: "tomorrow",
        title: "Tomorrow",
        subtitle: "Queued next",
        emptyLabel: "Tomorrow is open.",
        tasks: tomorrow,
        headerClass: "border-sky-500/20 bg-sky-500/10 text-sky-200",
      },
      {
        key: "this-week",
        title: "This Week",
        subtitle: "Upcoming",
        emptyLabel: "The week is light.",
        tasks: thisWeek,
        headerClass: "border-amber-500/20 bg-amber-500/10 text-amber-200",
      },
      {
        key: "later",
        title: "Later",
        subtitle: "Parked with dates",
        emptyLabel: "Nothing parked yet.",
        tasks: later,
        headerClass: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
      },
      {
        key: "no-date",
        title: "No Date",
        subtitle: "Needs placement",
        emptyLabel: "Everything has a slot.",
        tasks: noDate,
        headerClass: "border-white/10 bg-white/[0.03] text-slate-200",
      },
    ];
  }, [prioritizedOpenTasks]);

  const fallbackBriefing = useMemo(() => {
    if (tasks.length === 0) {
      return [
        "Things are pretty quiet right now.",
        "A good first move is to save something useful from Life or Dev so this starts feeling like your system instead of a blank slate.",
        "Planning the day or kicking off one focused dev thread would both be strong starts.",
      ].join("\n\n");
    }

    const overview =
      overdueCount > 0
        ? `You have ${openCount} open tasks, including ${overdueCount} overdue.`
        : dueSoonCount > 0
          ? `You have ${openCount} open tasks, and ${dueSoonCount} coming up soon.`
          : `You currently have ${openCount} open tasks and ${completedCount} completed.`;

    const focus =
      topTasks.length > 0
        ? `"${topTasks[0].title}" looks like the strongest next move${topTasks[0].dueDate ? `, due ${topTasks[0].dueDate}` : ""}.`
        : "This is a good moment to either tighten up saved work or start something fresh.";

    const nextMove =
      overdueCount > 0
        ? "Knock out one overdue item before adding more."
        : messages.length > 0
          ? "The current thread still has momentum, so picking it back up is probably the easiest win."
          : "Start a Life or Dev session and turn it into one concrete next step.";

    return [overview, focus, nextMove].join("\n\n");
  }, [tasks, overdueCount, dueSoonCount, openCount, completedCount, topTasks, messages.length]);

  useEffect(() => {
    if (mode !== "Home") return;

    const fetchHomeBriefing = async () => {
      setHomeBriefingLoading(true);
      try {
        const res = await fetch("http://127.0.0.1:8000/home-briefing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            openCount,
            completedCount,
            totalTasks: tasks.length,
            overdueCount,
            dueSoonCount,
            recentConversationCount: messages.length,
            topTasks: topTasks.map((task) => ({
              title: task.title,
              status: task.status,
              createdAt: task.createdAt,
              priority: task.priority,
              dueDate: task.dueDate || null,
            })),
          }),
        });

        const data = await res.json();
        setHomeBriefing(typeof data?.briefing === "string" ? data.briefing : fallbackBriefing);
      } catch {
        setHomeBriefing(fallbackBriefing);
      } finally {
        setHomeBriefingLoading(false);
      }
    };

    fetchHomeBriefing();
  }, [mode, homeBriefingRefreshKey, openCount, completedCount, tasks.length, overdueCount, dueSoonCount, messages.length, topTasks, fallbackBriefing]);

  useEffect(() => {
    if (mode !== "Home") return;

    const fetchInboxSummary = async () => {
      setInboxLoading(true);

      try {
        const res = await fetch("http://127.0.0.1:8000/inbox-summary", {
          method: "POST",
        });

        const data = await res.json();
        setInboxData(normalizeInboxData(data));
      } catch {
        setInboxData(
          normalizeInboxData({
            unreadCount: 0,
            summary: "",
            securityAlerts: [],
            important: [],
            actionNeeded: [],
            likelySpamOrPromo: [],
          })
        );
      } finally {
        setInboxLoading(false);
      }
    };

    fetchInboxSummary();
  }, [mode, homeBriefingRefreshKey]);

  const handleSubmit = async (customPrompt?: string) => {
    const finalPrompt = (customPrompt ?? chatInput).trim();
    if (!finalPrompt || mode === "Tasks" || mode === "Home") return;

    setLoading(true);

    const nextHistory = [...messages];
    const userMessage: ChatMessage = { role: "user", content: finalPrompt };

    setMessages((prev) => [...prev, userMessage]);
    setPrompt(finalPrompt);
    setChatInput("");

    try {
      const res = await fetch("http://127.0.0.1:8000/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
          mode,
          history: nextHistory,
        }),
      });

      const data = await res.json();
      const assistantReply = data.response || data.detail || "No response received.";

      setMessages((prev) => [...prev, { role: "assistant", content: assistantReply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error connecting to AnthonyOS backend." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setPrompt("");
    setChatInput("");
  };

  const addTaskWithDuplicateProtection = (incomingTask: TaskItem) => {
    const normalizedTask = normalizeTask(incomingTask);

    const duplicateExists = tasks.some((task) => {
      if (normalizedTask.sourceId && task.sourceId) {
        return task.sourceId === normalizedTask.sourceId;
      }

      return task.title.trim().toLowerCase() === normalizedTask.title.trim().toLowerCase() && task.status === "open";
    });

    if (duplicateExists) {
      setToast("Task already exists");
      return false;
    }

    setTasks((prev) => [normalizedTask, ...prev]);
    return true;
  };

  const saveTask = async () => {
    const taskTitle = prompt.trim() || "Saved AnthonyOS task";
    const taskDetails = latestAssistantMessage.trim();

    if (!taskDetails) return;

    setSavingTask(true);

    try {
      const res = await fetch("http://127.0.0.1:8000/suggest-task-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle,
          details: taskDetails,
          mode,
        }),
      });

      const data = await res.json();

      const newTask: TaskItem = {
        id: crypto.randomUUID(),
        title: taskTitle,
        details: taskDetails,
        createdAt: new Date().toISOString(),
        status: "open",
        priority:
          data.priority === "low" || data.priority === "medium" || data.priority === "high"
            ? data.priority
            : "medium",
        dueDate: typeof data.dueDate === "string" ? data.dueDate : "",
        sourceType: "chat",
        sourceLabel: mode,
      };

      if (addTaskWithDuplicateProtection(newTask)) {
        setToast("Saved to tasks");
      }
    } catch {
      const newTask: TaskItem = {
        id: crypto.randomUUID(),
        title: taskTitle,
        details: taskDetails,
        createdAt: new Date().toISOString(),
        status: "open",
        priority: "medium",
        dueDate: "",
        sourceType: "chat",
        sourceLabel: mode,
      };

      if (addTaskWithDuplicateProtection(newTask)) {
        setToast("Saved to tasks");
      }
    } finally {
      setSavingTask(false);
    }
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id));
    if (selectedTaskId === id) {
      setSelectedTaskId(null);
      setTaskEditTitle("");
      setTaskEditDetails("");
      setTaskEditPriority("medium");
      setTaskEditDueDate("");
    }
    setToast("Task removed");
  };

  const toggleTaskStatus = (id: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? { ...task, status: task.status === "open" ? "completed" : "open" }
          : task
      )
    );
    setToast("Task updated");
  };

  const loadTaskIntoWorkspace = (task: TaskItem) => {
    setSelectedTaskId(task.id);
    setTaskEditTitle(task.title);
    setTaskEditDetails(task.details);
    setTaskEditPriority(task.priority);
    setTaskEditDueDate(task.dueDate);
    setMode("Tasks");
  };

  const saveTaskEdits = () => {
    if (!selectedTaskId) return;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === selectedTaskId
          ? {
              ...task,
              title: taskEditTitle.trim() || task.title,
              details: taskEditDetails.trim() || task.details,
              priority: taskEditPriority,
              dueDate: taskEditDueDate,
            }
          : task
      )
    );

    setToast("Changes saved");
  };

  const priorityPill = (priority: TaskPriority) => {
    if (priority === "high") return "bg-red-500/15 text-red-300 border border-red-500/20";
    if (priority === "medium") return "bg-amber-500/15 text-amber-300 border border-amber-500/20";
    return "bg-slate-800/90 text-slate-300 border border-white/10";
  };

  const taskCardClass = (task: TaskItem) => {
    if (task.status === "completed") {
      return "border-emerald-500/20 bg-emerald-500/10";
    }
    if (isOverdue(task.dueDate)) {
      return "border-red-500/25 bg-red-500/10 ring-1 ring-red-500/15";
    }
    if (isDueSoon(task.dueDate)) {
      return "border-amber-500/25 bg-amber-500/10 ring-1 ring-amber-500/15";
    }
    if (task.priority === "high") {
      return "border-rose-500/20 bg-rose-500/10";
    }
    return "border-white/10 bg-slate-950/35";
  };

  const taskTitleClass = (task: TaskItem) => {
    if (task.status === "completed") return "text-slate-100";
    if (isOverdue(task.dueDate)) return "text-red-100";
    if (isDueSoon(task.dueDate)) return "text-amber-100";
    if (task.priority === "high") return "text-rose-100";
    return "text-slate-100";
  };

  const captureNote = async () => {
    const trimmedTitle = noteTitle.trim() || "Shared Family To-Dos";
    const trimmedContent = noteContent.trim();

    if (!trimmedContent) {
      setToast("Paste the note first");
      return;
    }

    setNoteLoading(true);

    try {
      const res = await fetch("http://127.0.0.1:8000/capture-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          content: trimmedContent,
          source: "apple_notes_share",
          capturedAt: new Date().toISOString(),
        }),
      });

      const data = await res.json();
      const snapshot: NoteSnapshot = {
        id: typeof data.snapshotId === "string" ? data.snapshotId : crypto.randomUUID(),
        title: data.title || trimmedTitle,
        content: data.content || trimmedContent,
        summary: typeof data.summary === "string" ? data.summary : "",
        capturedAt: new Date().toISOString(),
        lineCount: typeof data.lineCount === "number" ? data.lineCount : trimmedContent.split(/\n+/).filter(Boolean).length,
        source: data.source || "apple_notes_share",
      };

      setNotes((prev) => [snapshot, ...prev.filter((item) => item.id !== snapshot.id)]);
      setToast("Shared note captured");
    } catch (error) {
      console.error("Failed to capture note", error);
      setToast("Could not capture note");
    } finally {
      setNoteLoading(false);
    }
  };

  const captureNoteAndCreateTasks = async () => {
    const trimmedTitle = noteTitle.trim() || "Shared Family To-Dos";
    const trimmedContent = noteContent.trim();

    if (!trimmedContent) {
      setToast("Paste the note first");
      return;
    }

    setNoteTaskLoading(true);

    try {
      const captureRes = await fetch("http://127.0.0.1:8000/capture-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          content: trimmedContent,
          source: "apple_notes_share",
          capturedAt: new Date().toISOString(),
        }),
      });

      const captureData = await captureRes.json();
      const snapshotId = typeof captureData.snapshotId === "string" ? captureData.snapshotId : crypto.randomUUID();
      const snapshot: NoteSnapshot = {
        id: snapshotId,
        title: captureData.title || trimmedTitle,
        content: captureData.content || trimmedContent,
        summary: typeof captureData.summary === "string" ? captureData.summary : "",
        capturedAt: new Date().toISOString(),
        lineCount: typeof captureData.lineCount === "number" ? captureData.lineCount : trimmedContent.split(/\n+/).filter(Boolean).length,
        source: captureData.source || "apple_notes_share",
      };

      setNotes((prev) => [snapshot, ...prev.filter((item) => item.id !== snapshot.id)]);

      const extractRes = await fetch("http://127.0.0.1:8000/extract-tasks-from-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          content: trimmedContent,
          mode: "Life",
          source: "apple_notes_share",
          capturedAt: new Date().toISOString(),
        }),
      });

      const extractData = await extractRes.json();
      const extractedTasks = Array.isArray(extractData?.tasks) ? extractData.tasks : [];

      let createdCount = 0;
      extractedTasks.forEach((item: any, index: number) => {
        const taskTitle = typeof item?.title === "string" ? item.title.trim() : "";
        if (!taskTitle) return;

        const created = addTaskWithDuplicateProtection({
          id: crypto.randomUUID(),
          title: taskTitle,
          details: typeof item?.details === "string" && item.details.trim()
            ? item.details
            : `Source note: ${trimmedTitle}`,
          createdAt: new Date().toISOString(),
          status: "open",
          priority:
            item?.priority === "low" || item?.priority === "medium" || item?.priority === "high"
              ? item.priority
              : "medium",
          dueDate: typeof item?.dueDate === "string" ? item.dueDate : "",
          sourceType: "note",
          sourceId: `${snapshotId}:${index}:${taskTitle.toLowerCase()}`,
          sourceLabel: snapshot.title,
        });

        if (created) createdCount += 1;
      });

      setToast(createdCount > 0 ? `Created ${createdCount} tasks from note` : "No new tasks were created");
      if (createdCount > 0) {
        setMode("Tasks");
      }
    } catch (error) {
      console.error("Failed to turn note into tasks", error);
      setToast("Could not create tasks from note");
    } finally {
      setNoteTaskLoading(false);
    }
  };

  const createTaskFromEmail = async (
    email: InboxEmail,
    category: "securityAlerts" | "important" | "actionNeeded" | "likelySpamOrPromo"
  ) => {
    try {
      const res = await fetch("http://127.0.0.1:8000/create-task-from-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: email.subject,
          from_email: email.from,
          snippet: email.reason || "",
          body: email.reason || "",
          category,
        }),
      });

      const data = await res.json();

      const newTask: TaskItem = {
        id: crypto.randomUUID(),
        title: data.title || email.subject || "Email Task",
        details: data.details || email.reason || "",
        createdAt: new Date().toISOString(),
        status: "open",
        priority:
          data.priority === "low" || data.priority === "medium" || data.priority === "high"
            ? data.priority
            : category === "securityAlerts"
              ? "high"
              : "medium",
        dueDate: typeof data.dueDate === "string" ? data.dueDate : "",
        sourceType: "email",
        sourceId: typeof data.sourceEmailId === "string" && data.sourceEmailId
          ? data.sourceEmailId
          : `${category}:${email.subject}:${email.from}`,
        sourceLabel: email.from || "Inbox",
      };

      if (addTaskWithDuplicateProtection(newTask)) {
        setToast("Task created from inbox");
        setMode("Tasks");
      }
    } catch (err) {
      console.error("Failed to create task from email", err);
      setToast("Could not create task");
    }
  };

  const secondaryButton =
    "rounded-xl border border-white/12 bg-slate-950/40 px-4 py-2 text-slate-200 transition hover:-translate-y-[1px] hover:border-white/20 hover:bg-slate-900/80 active:scale-[0.98]";
  const primaryButton =
    "rounded-xl bg-slate-100 px-4 py-2 text-slate-950 transition hover:-translate-y-[1px] hover:bg-white active:scale-[0.98] disabled:opacity-50";
  const navButton = (active: boolean) =>
    `mb-2 flex items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
      active
        ? "bg-slate-800/95 text-white ring-1 ring-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
        : "text-slate-300 hover:bg-slate-900/70 hover:text-white"
    }`;

  return (
    <div suppressHydrationWarning className="flex min-h-screen bg-transparent text-slate-100">
      {toast && (
        <div className="fixed right-5 top-5 z-50 rounded-xl border border-white/10 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-[fadeSlideIn_0.25s_ease-out]">
          {toast}
        </div>
      )}

      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-white/10 bg-slate-950/55 p-6 backdrop-blur-2xl lg:flex lg:flex-col">
        <div>
          <div className="mb-1 text-xs uppercase tracking-[0.24em] text-slate-500">AnthonyOS</div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Control center</h1>
        </div>

        <div className="mt-8">
          <button className={navButton(mode === "Home")} onClick={() => setMode("Home")}>
            <span>Home</span>
          </button>
          <button className={navButton(mode === "Life")} onClick={() => setMode("Life")}>
            <span>Life</span>
          </button>
          <button className={navButton(mode === "Dev")} onClick={() => setMode("Dev")}>
            <span>Dev</span>
          </button>
          <button className={navButton(mode === "Tasks")} onClick={() => setMode("Tasks")}>
            <span>Tasks</span>
          </button>
        </div>

        <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
          <div className="text-slate-200">{mode}</div>
          <div className="mt-2 leading-6">
            {mode === "Home" && "A cleaner view of what matters, what is waiting, and where to jump back in."}
            {mode === "Life" && "Think through life stuff, make plans, and keep things moving."}
            {mode === "Dev" && "Brainstorm, debug, build, and ship without losing your flow."}
            {mode === "Tasks" && "Trim the noise, keep the signal, and move the right things forward."}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-5 sm:p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{mode}</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {mode === "Home" && "What’s moving"}
                {mode === "Life" && "Life"}
                {mode === "Dev" && "Dev"}
                {mode === "Tasks" && "Tasks"}
              </h2>
              <p className="mt-3 max-w-2xl text-slate-400">
                {mode === "Home" && "A quieter, sharper look at what deserves attention right now."}
                {mode === "Life" && "Use this space to think clearly, plan well, and keep momentum."}
                {mode === "Dev" && "Use this space to build, troubleshoot, and keep shipping."}
                {mode === "Tasks" && "A tighter view of what is active, what is done, and what still needs attention."}
              </p>
            </div>

            <div className="flex gap-2">
              <button className={secondaryButton} onClick={() => setMode("Home")}>
                Home
              </button>
              <button className={secondaryButton} onClick={() => setHomeBriefingRefreshKey((prev) => prev + 1)}>
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <section className="space-y-6 xl:col-span-2">
              {mode === "Home" ? (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                    <div className={`${subtleCard} p-5`}>
                      <div className="text-sm text-slate-400">Open</div>
                      <div className="mt-2 text-3xl font-semibold text-white">{openCount}</div>
                    </div>
                    <div className={`${subtleCard} p-5`}>
                      <div className="text-sm text-slate-400">Completed</div>
                      <div className="mt-2 text-3xl font-semibold text-white">{completedCount}</div>
                    </div>
                    <div className={`${subtleCard} p-5`}>
                      <div className="text-sm text-slate-400">Overdue</div>
                      <div className="mt-2 text-3xl font-semibold text-red-300">{overdueCount}</div>
                    </div>
                    <div className={`${subtleCard} p-5`}>
                      <div className="text-sm text-slate-400">Due soon</div>
                      <div className="mt-2 text-3xl font-semibold text-amber-300">{dueSoonCount}</div>
                    </div>
                    <div className={`${subtleCard} p-5`}>
                      <div className="text-sm text-slate-400">Today</div>
                      <div className="mt-2 text-lg font-medium text-white">{isClient ? new Date().toLocaleDateString() : ""}</div>
                    </div>
                    <div className="rounded-2xl border border-red-500/15 bg-red-500/10 p-5 shadow-[0_10px_36px_rgba(0,0,0,0.22)]">
                      <div className="text-sm text-red-200/80">Watchlist</div>
                      <div className="mt-2 text-3xl font-semibold text-red-200">{securityAlertCount}</div>
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-white">Planner board</h3>
                        <p className="mt-1 text-sm text-slate-400">
                          Notes, inbox, and chat-created work all land here.
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        {homeBriefingLoading && <span className="text-sm text-slate-400">Refreshing…</span>}
                        <button
                          className={secondaryButton}
                          onClick={() => setHomeBriefingRefreshKey((prev) => prev + 1)}
                          disabled={homeBriefingLoading}
                        >
                          Refresh
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {plannerColumns.map((column) => (
                        <div key={column.key} className="min-w-[240px] max-w-[240px] shrink-0">
                          <div className="mb-3 flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-white">{column.title}</div>
                              <div className="text-xs text-slate-500">{column.subtitle}</div>
                            </div>
                            <span className={`rounded-full border px-2 py-1 text-[11px] ${column.headerClass}`}>
                              {column.tasks.length}
                            </span>
                          </div>

                          <div className="min-h-[320px] rounded-2xl border border-white/10 bg-slate-950/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                            <div className="space-y-3">
                              {column.tasks.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-500">
                                  {column.emptyLabel}
                                </div>
                              ) : (
                                column.tasks.map((task) => (
                                  <button
                                    key={task.id}
                                    className={`w-full rounded-xl border p-3 text-left transition hover:-translate-y-[1px] hover:border-white/15 ${taskCardClass(task)}`}
                                    onClick={() => loadTaskIntoWorkspace(task)}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className={`line-clamp-2 text-sm font-semibold ${taskTitleClass(task)}`}>
                                          {task.title}
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <span className={`rounded-full px-2 py-1 text-[11px] ${priorityPill(task.priority)}`}>
                                            {task.priority}
                                          </span>
                                          <span className={`rounded-full border px-2 py-1 text-[11px] ${sourceBadgeClass(task.sourceType)}`}>
                                            {sourceBadgeLabel(task)}
                                          </span>
                                          {task.dueDate && (
                                            <span className="rounded-full border border-white/10 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300">
                                              {isClient ? formatShortDateSafe(task.dueDate) : task.dueDate}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-white">Jump back in</h3>
                      {latestNote && (
                        <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-xs text-violet-200">
                          {latestNote.lineCount} lines
                        </span>
                      )}
                    </div>

                    {latestNote ? (
                      <div className="space-y-4">
                        <div>
                          <div className="text-sm font-medium text-white">{latestNote.title}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">Latest shared note snapshot</div>
                        </div>
                        <p className="text-sm leading-6 text-slate-300">
                          {latestNote.summary || "A shared planning note is ready to turn into tasks."}
                        </p>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Preview</div>
                          <div className="line-clamp-6 whitespace-pre-wrap">{latestNote.content}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">
                        Capture your shared Apple note here and AnthonyOS can turn it into dashboard tasks.
                      </div>
                    )}
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <h3 className="mb-4 text-lg font-semibold text-white">In motion</h3>

                    <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-400">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">{filteredTasks.length} shown</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">{openCount} open</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">{completedCount} completed</span>
                    </div>

                    <div className="space-y-3">
                      {topTasks.length === 0 ? (
                        <div className="text-sm text-slate-400">
                          No open tasks yet. Save something useful from Life or Dev and it will land here.
                        </div>
                      ) : (
                        topTasks.map((task) => (
                          <div
                            key={task.id}
                            className={`rounded-xl border p-4 transition hover:-translate-y-[1px] ${taskCardClass(task)}`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className={`font-semibold ${taskTitleClass(task)}`}>{task.title}</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className={`rounded-full px-2 py-1 text-xs ${priorityPill(task.priority)}`}>
                                    {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} priority
                                  </span>
                                  <span className={`rounded-full border px-2 py-1 text-xs ${sourceBadgeClass(task.sourceType)}`}>
                                    {sourceBadgeLabel(task)}
                                  </span>
                                  {task.priority === "high" && task.status === "open" && (
                                    <span className="rounded-full border border-rose-500/20 bg-rose-500/15 px-2 py-1 text-xs text-rose-300">
                                      High attention
                                    </span>
                                  )}
                                  {task.dueDate && (
                                    <span className="rounded-full border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
                                      Due {isClient ? formatShortDateSafe(task.dueDate) : task.dueDate}
                                    </span>
                                  )}
                                  {task.dueDate && isOverdue(task.dueDate) && (
                                    <span className="rounded-full border border-red-500/20 bg-red-500/15 px-2 py-1 text-xs text-red-300">
                                      Overdue
                                    </span>
                                  )}
                                  {task.dueDate && !isOverdue(task.dueDate) && isDueSoon(task.dueDate) && (
                                    <span className="rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
                                      Due soon
                                    </span>
                                  )}
                                </div>
                              </div>

                              <button className={secondaryButton} onClick={() => loadTaskIntoWorkspace(task)}>
                                View
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <h3 className="text-lg font-semibold text-white">Today snapshot</h3>
                      {homeBriefingLoading && <span className="text-sm text-slate-400">Refreshing…</span>}
                    </div>

                    <div className="whitespace-pre-wrap text-slate-300 leading-7">
                      {cleanBriefingText(homeBriefing || fallbackBriefing)}
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <h3 className="mb-4 text-lg font-semibold text-white">Jump back in</h3>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <button
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-[1px] hover:border-white/15 hover:bg-white/[0.05]"
                        onClick={() => {
                          setMode("Life");
                          setChatInput("Plan my day today.");
                        }}
                      >
                        <div className="font-semibold text-white">Plan the day</div>
                        <div className="mt-1 text-sm text-slate-400">Jump into Life mode with a practical planning prompt.</div>
                      </button>

                      <button
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-[1px] hover:border-white/15 hover:bg-white/[0.05]"
                        onClick={() => {
                          setMode("Dev");
                          setChatInput("Help me start a side project.");
                        }}
                      >
                        <div className="font-semibold text-white">Start a dev session</div>
                        <div className="mt-1 text-sm text-slate-400">Pick something to build and get back into flow.</div>
                      </button>

                      <button
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-[1px] hover:border-white/15 hover:bg-white/[0.05]"
                        onClick={() => setMode("Tasks")}
                      >
                        <div className="font-semibold text-white">Review tasks</div>
                        <div className="mt-1 text-sm text-slate-400">Tighten up what’s already here and keep it moving.</div>
                      </button>

                      <button
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-[1px] hover:border-white/15 hover:bg-white/[0.05]"
                        onClick={() => setHomeBriefingRefreshKey((prev) => prev + 1)}
                      >
                        <div className="font-semibold text-white">Refresh inbox</div>
                        <div className="mt-1 text-sm text-slate-400">Pull the latest summary and update the home view.</div>
                      </button>
                    </div>
                  </div>
                </>
              ) : mode !== "Tasks" ? (
                <>
                  <div className={`${shellCard} p-6`}>
                    <h3 className="mb-2 text-lg font-semibold text-white">Jump back in</h3>
                    <p className="mb-4 text-sm text-slate-400">Click one to start somewhere useful.</p>

                    <div className="space-y-3">
                      {quickActions[mode].map((action) => (
                        <button
                          key={action.title}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-[1px] hover:border-white/15 hover:bg-white/[0.05]"
                          onClick={() => handleSubmit(action.prompt)}
                          disabled={loading}
                        >
                          <div className="font-semibold text-white">{action.title}</div>
                          <div className="mt-1 text-sm text-slate-400">{action.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <label className="mb-3 block text-sm font-medium text-slate-300">
                      Start or continue the conversation
                    </label>

                    <textarea
                      className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 shadow-[0_10px_30px_rgba(0,0,0,0.25)] placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-600"
                      rows={4}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={`Talk through it here in ${mode} mode...`}
                    />

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button className={primaryButton} onClick={() => handleSubmit()} disabled={loading}>
                        {loading ? "Running..." : "Send"}
                      </button>

                      <button
                        className={secondaryButton}
                        onClick={saveTask}
                        disabled={!latestAssistantMessage.trim() || loading || savingTask}
                      >
                        {savingTask ? "Saving..." : "Save to tasks"}
                      </button>

                      <button className={secondaryButton} onClick={clearConversation} disabled={loading}>
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className={`${shellCard} min-h-[440px] p-6`}>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-white">Conversation</h3>
                      {loading && <span className="text-sm text-slate-400">Thinking…</span>}
                    </div>

                    <div className="flex max-h-[460px] flex-col gap-4 overflow-auto pr-1">
                      {messages.length === 0 ? (
                        <div className="text-slate-400">Your conversation will show up here once you start.</div>
                      ) : (
                        messages.map((message, index) => (
                          <div
                            key={index}
                            className={`rounded-2xl border p-4 ${
                              message.role === "user"
                                ? "ml-10 border-slate-700 bg-slate-800/90 text-white"
                                : "mr-10 border-white/10 bg-white/[0.03] text-slate-100"
                            }`}
                          >
                            <div className="mb-2 text-[11px] uppercase tracking-[0.24em] opacity-60">
                              {message.role === "user" ? "You" : "AnthonyOS"}
                            </div>
                            <div className="whitespace-pre-wrap leading-7">{message.content}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-6 border-t border-white/10 pt-4">
                      <label className="mb-3 block text-sm font-medium text-slate-300">Follow-up</label>
                      <textarea
                        className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-600"
                        rows={3}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Keep the thread going..."
                      />
                      <div className="mt-3">
                        <button className={primaryButton} onClick={() => handleSubmit()} disabled={loading}>
                          {loading ? "Sending..." : "Send follow-up"}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={`${shellCard} p-6`}>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-white">Selected task</h3>
                      <div className="flex gap-2">
                        <button className={secondaryButton} onClick={saveTaskEdits} disabled={!selectedTaskId}>
                          Save
                        </button>
                        <button
                          className={secondaryButton}
                          onClick={() => {
                            setSelectedTaskId(null);
                            setTaskEditTitle("");
                            setTaskEditDetails("");
                            setTaskEditPriority("medium");
                            setTaskEditDueDate("");
                          }}
                        >
                          Deselect
                        </button>
                      </div>
                    </div>

                    <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Editing</div>
                      <div className="mt-2 text-sm text-slate-300">
                        {selectedTaskId
                          ? "You can tighten the title, clean up the details, or adjust timing without leaving this view."
                          : "Select something from the queue below to start editing it here."}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">Title</label>
                        <input
                          className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-600"
                          value={taskEditTitle}
                          onChange={(e) => setTaskEditTitle(e.target.value)}
                          placeholder="Pick a task from the queue..."
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">Details</label>
                        <textarea
                          className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-600"
                          rows={7}
                          value={taskEditDetails}
                          onChange={(e) => setTaskEditDetails(e.target.value)}
                          placeholder="Notes, context, and next steps..."
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-300">Priority</label>
                          <select
                            className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-600"
                            value={taskEditPriority}
                            onChange={(e) => setTaskEditPriority(e.target.value as TaskPriority)}
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-300">Due date</label>
                          <input
                            type="date"
                            className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-600"
                            value={taskEditDueDate}
                            onChange={(e) => setTaskEditDueDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-white">Queue</h3>

                      <div className="flex gap-2">
                        <button
                          className={taskFilter === "all" ? primaryButton : secondaryButton}
                          onClick={() => setTaskFilter("all")}
                        >
                          All
                        </button>
                        <button
                          className={taskFilter === "open" ? primaryButton : secondaryButton}
                          onClick={() => setTaskFilter("open")}
                        >
                          Open
                        </button>
                        <button
                          className={taskFilter === "completed" ? primaryButton : secondaryButton}
                          onClick={() => setTaskFilter("completed")}
                        >
                          Completed
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {filteredTasks.length === 0 ? (
                        <div className="text-slate-400">Nothing is in the queue yet.</div>
                      ) : (
                        filteredTasks.map((task) => (
                          <div
                            key={task.id}
                            className={`rounded-xl border p-4 transition hover:-translate-y-[1px] ${taskCardClass(task)}`}
                          >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className={`font-semibold ${taskTitleClass(task)}`}>{task.title}</div>
                                <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-slate-300">
                                  {task.details}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <span className={`rounded-full px-2 py-1 text-xs ${priorityPill(task.priority)}`}>
                                    {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} priority
                                  </span>
                                  <span className={`rounded-full border px-2 py-1 text-xs ${sourceBadgeClass(task.sourceType)}`}>
                                    {sourceBadgeLabel(task)}
                                  </span>
                                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
                                    {task.status === "open" ? "Open" : "Completed"}
                                  </span>
                                  {task.dueDate && (
                                    <span className="rounded-full border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
                                      Due {isClient ? formatShortDateSafe(task.dueDate) : task.dueDate}
                                    </span>
                                  )}
                                  {task.dueDate && isOverdue(task.dueDate) && task.status === "open" && (
                                    <span className="rounded-full border border-red-500/20 bg-red-500/15 px-2 py-1 text-xs text-red-300">
                                      Overdue
                                    </span>
                                  )}
                                  {task.dueDate && !isOverdue(task.dueDate) && isDueSoon(task.dueDate) && task.status === "open" && (
                                    <span className="rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
                                      Due soon
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 lg:justify-end">
                                <button className={secondaryButton} onClick={() => loadTaskIntoWorkspace(task)}>
                                  Edit
                                </button>
                                <button className={secondaryButton} onClick={() => toggleTaskStatus(task.id)}>
                                  {task.status === "open" ? "Complete" : "Reopen"}
                                </button>
                                <button
                                  className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-red-200 transition hover:-translate-y-[1px] hover:bg-red-500/15 active:scale-[0.98]"
                                  onClick={() => deleteTask(task.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>

            <aside className="space-y-6">
              {mode === "Home" ? (
                <>
                  <div className={`${shellCard} p-6`}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-white">Shared note capture</h3>
                      <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-200">Apple Notes bridge</span>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">Note title</label>
                        <input
                          className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-600"
                          value={noteTitle}
                          onChange={(e) => setNoteTitle(e.target.value)}
                          placeholder="Shared Family To-Dos"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">Paste the note</label>
                        <textarea
                          className="w-full rounded-xl border border-white/12 bg-slate-950/70 p-4 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-600"
                          rows={10}
                          value={noteContent}
                          onChange={(e) => setNoteContent(e.target.value)}
                          placeholder={"Week\n- Call dentist by Friday\n- Pay electric bill on the 15th\n\nMonth\n- Plan summer trip"}
                        />
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button className={secondaryButton} onClick={captureNote} disabled={noteLoading || noteTaskLoading}>
                          {noteLoading ? "Capturing..." : "Capture note"}
                        </button>
                        <button className={primaryButton} onClick={captureNoteAndCreateTasks} disabled={noteLoading || noteTaskLoading}>
                          {noteTaskLoading ? "Creating..." : "Capture + create tasks"}
                        </button>
                      </div>

                      <p className="text-sm leading-6 text-slate-400">
                        This is the bridge point for a shared Apple note today. Later, your iPhone shortcut can send the same payload straight into this panel.
                      </p>
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-white">Inbox</h3>
                      <div className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-slate-300">
                        {inboxData?.unreadCount ?? 0} unread
                      </div>
                    </div>

                    {inboxLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((item) => (
                          <div key={item} className="animate-pulse rounded-xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="h-4 w-2/3 rounded bg-white/10" />
                            <div className="mt-3 h-3 w-1/2 rounded bg-white/10" />
                            <div className="mt-4 h-3 w-full rounded bg-white/10" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div>
                          <h4 className="mb-2 text-sm font-medium text-slate-200">Snapshot</h4>
                          <p className="text-sm leading-6 text-slate-400">
                            {inboxData?.summary || "Nothing urgent is standing out yet."}
                          </p>
                        </div>

                        {inboxData?.securityAlerts && inboxData.securityAlerts.length > 0 && (
                          <div>
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-sm font-medium text-red-200">Watchlist</h4>
                              <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
                                High attention
                              </span>
                            </div>

                            <div className="space-y-3">
                              {inboxData.securityAlerts.map((email, idx) => (
                                <div
                                  key={`${email.subject}-${idx}`}
                                  className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 transition hover:-translate-y-[1px]"
                                >
                                  <div className="font-medium text-white">{email.subject || "(No subject)"}</div>
                                  <div className="mt-1 text-sm text-red-100/80">{email.from}</div>
                                  {email.reason && <div className="mt-2 text-sm text-red-100/90">{email.reason}</div>}
                                  <button
                                    className="mt-3 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-red-400 active:scale-[0.98]"
                                    onClick={() => createTaskFromEmail(email, "securityAlerts")}
                                  >
                                    Create task
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <h4 className="mb-3 text-sm font-medium text-slate-200">Needs you</h4>
                          <div className="space-y-3">
                            {(inboxData?.actionNeeded ?? []).length === 0 ? (
                              <div className="text-sm text-slate-500">Nothing here right now.</div>
                            ) : (
                              inboxData!.actionNeeded.map((email, idx) => (
                                <div
                                  key={`${email.subject}-${idx}`}
                                  className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 transition hover:-translate-y-[1px]"
                                >
                                  <div className="font-medium text-white">{email.subject || "(No subject)"}</div>
                                  <div className="mt-1 text-sm text-slate-400">{email.from}</div>
                                  {email.reason && <div className="mt-2 text-sm text-slate-300">{email.reason}</div>}
                                  <button
                                    className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-950 transition hover:bg-white active:scale-[0.98]"
                                    onClick={() => createTaskFromEmail(email, "actionNeeded")}
                                  >
                                    Create task
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div>
                          <h4 className="mb-3 text-sm font-medium text-slate-200">Worth a look</h4>
                          <div className="space-y-3">
                            {(inboxData?.important ?? []).length === 0 ? (
                              <div className="text-sm text-slate-500">Nothing surfaced here yet.</div>
                            ) : (
                              inboxData!.important.map((email, idx) => (
                                <div
                                  key={`${email.subject}-${idx}`}
                                  className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 transition hover:-translate-y-[1px]"
                                >
                                  <div className="font-medium text-white">{email.subject || "(No subject)"}</div>
                                  <div className="mt-1 text-sm text-slate-400">{email.from}</div>
                                  {email.reason && <div className="mt-2 text-sm text-slate-300">{email.reason}</div>}
                                  <button
                                    className="mt-3 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/[0.08] active:scale-[0.98]"
                                    onClick={() => createTaskFromEmail(email, "important")}
                                  >
                                    Create task
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div>
                          <h4 className="mb-3 text-sm font-medium text-slate-200">Low priority inbox</h4>
                          <div className="space-y-3">
                            {(inboxData?.likelySpamOrPromo ?? []).length === 0 ? (
                              <div className="text-sm text-slate-500">Nothing here right now.</div>
                            ) : (
                              inboxData!.likelySpamOrPromo.map((email, idx) => {
                                const isSecurityAlert = /password|verification|sign in|login|security|suspicious|recovery|reset/i.test(
                                  `${email.subject} ${email.reason} ${email.from}`
                                );

                                return (
                                  <div
                                    key={`${email.subject}-${idx}`}
                                    className={`rounded-xl border p-4 transition hover:-translate-y-[1px] ${
                                      isSecurityAlert
                                        ? "border-red-500/20 bg-red-500/10"
                                        : "border-white/10 bg-white/[0.03]"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="font-medium text-white">{email.subject || "(No subject)"}</div>
                                        <div className="mt-1 text-sm text-slate-400">{email.from}</div>
                                      </div>
                                      <span
                                        className={`rounded-full px-2 py-1 text-[11px] ${
                                          isSecurityAlert
                                            ? "border border-red-500/20 bg-red-500/15 text-red-200"
                                            : "border border-white/10 bg-white/[0.03] text-slate-300"
                                        }`}
                                      >
                                        {isSecurityAlert ? "Security alert" : "Promo / spam"}
                                      </span>
                                    </div>
                                    {email.reason && <div className="mt-2 text-sm text-slate-400">{email.reason}</div>}
                                    {isSecurityAlert && (
                                      <button
                                        className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-950 transition hover:bg-white active:scale-[0.98]"
                                        onClick={() => createTaskFromEmail(email, "securityAlerts")}
                                      >
                                        Create task
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className={`${shellCard} p-6`}>
                    <h3 className="mb-3 text-lg font-semibold text-white">Suggestions</h3>
                    <div className="space-y-2 text-sm text-slate-300">
                      {mode === "Life" ? (
                        <>
                          <div>• Help me plan the rest of today</div>
                          <div>• Break this week into realistic priorities</div>
                          <div>• I’m stuck — what should I do first?</div>
                          <div>• Build me a simple routine I’ll follow</div>
                        </>
                      ) : mode === "Dev" ? (
                        <>
                          <div>• Help me scope this feature before I build it</div>
                          <div>• Debug this issue step by step</div>
                          <div>• Refactor this without overcomplicating it</div>
                          <div>• What should I build next?</div>
                        </>
                      ) : (
                        <div>Nothing to show here right now.</div>
                      )}
                    </div>
                  </div>

                  <div className={`${shellCard} p-6`}>
                    <h3 className="mb-3 text-lg font-semibold text-white">Current thread</h3>
                    <p className="text-sm leading-6 text-slate-400">
                      {messages.length > 0
                        ? "You already have context in motion here, so continuing this thread is probably the easiest win."
                        : "Once you start a conversation, this area becomes a quick read on where things stand."}
                    </p>
                  </div>
                </>
              )}
            </aside>
          </div>
        </div>
      </main>

      <style jsx global>{`
        @keyframes fadeSlideIn {
          0% {
            opacity: 0;
            transform: translateY(-6px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
