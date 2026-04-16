type InboxLikeIssue = {
  id: string;
  status: string;
  assigneeUserId: string | null;
  isUnreadForMe?: boolean;
  lastExternalCommentAt?: string | null;
  myLastTouchAt?: string | null;
  updatedAt?: string | null;
};

export type InboxReplyOverrides = Record<string, string>;

const INBOX_REPLY_OVERRIDES_KEY = "inbox:reply-overrides";
const INBOX_REPLY_OVERRIDES_EVENT = "inbox:reply-overrides-changed";
const INBOX_ARCHIVED_KEY = "inbox:archived";
const INBOX_ARCHIVED_EVENT = "inbox:archived-changed";

function toTime(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getOverrideTime(issue: InboxLikeIssue, overrides?: InboxReplyOverrides): number {
  return toTime(overrides?.[issue.id]);
}

function getMyTouchTime(issue: InboxLikeIssue, overrides?: InboxReplyOverrides): number {
  return Math.max(toTime(issue.myLastTouchAt), getOverrideTime(issue, overrides));
}

export function readInboxReplyOverrides(): InboxReplyOverrides {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(INBOX_REPLY_OVERRIDES_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as InboxReplyOverrides : {};
  } catch {
    return {};
  }
}

export function writeInboxReplyOverrides(overrides: InboxReplyOverrides) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(INBOX_REPLY_OVERRIDES_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new CustomEvent(INBOX_REPLY_OVERRIDES_EVENT));
}

export function setInboxReplyOverride(issueId: string, repliedAt: string): InboxReplyOverrides {
  const next = {
    ...readInboxReplyOverrides(),
    [issueId]: repliedAt,
  };
  writeInboxReplyOverrides(next);
  return next;
}

export function subscribeInboxReplyOverrides(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => listener();
  window.addEventListener("storage", handleChange);
  window.addEventListener(INBOX_REPLY_OVERRIDES_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(INBOX_REPLY_OVERRIDES_EVENT, handleChange);
  };
}

export function readInboxArchivedIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(INBOX_ARCHIVED_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function writeInboxArchivedIds(ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(INBOX_ARCHIVED_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent(INBOX_ARCHIVED_EVENT));
}

export function subscribeInboxArchivedIds(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => listener();
  window.addEventListener("storage", handleChange);
  window.addEventListener(INBOX_ARCHIVED_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(INBOX_ARCHIVED_EVENT, handleChange);
  };
}

export function issueNeedsReply(issue: InboxLikeIssue, overrides?: InboxReplyOverrides): boolean {
  if (["done", "cancelled"].includes(issue.status)) {
    return false;
  }

  if (issue.status === "blocked") {
    return true;
  }

  const externalTime = toTime(issue.lastExternalCommentAt);
  const myTime = getMyTouchTime(issue, overrides);
  const assignedToBoard = issue.assigneeUserId === "local-board";
  const updatedTime = toTime(issue.updatedAt);

  if (externalTime > 0) {
    return externalTime >= myTime;
  }

  if (myTime > 0) {
    return updatedTime > myTime + 1000;
  }

  if (issue.isUnreadForMe) {
    return true;
  }

  return assignedToBoard;
}

export function issueIsSent(issue: InboxLikeIssue, overrides?: InboxReplyOverrides): boolean {
  if (["done", "cancelled"].includes(issue.status)) {
    return false;
  }

  return !issueNeedsReply(issue, overrides) && getMyTouchTime(issue, overrides) > 0;
}
