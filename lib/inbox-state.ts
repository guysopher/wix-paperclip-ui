type InboxLikeIssue = {
  status: string;
  assigneeUserId: string | null;
  isUnreadForMe?: boolean;
  lastExternalCommentAt?: string | null;
  myLastTouchAt?: string | null;
};

function toTime(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function issueNeedsReply(issue: InboxLikeIssue): boolean {
  if (["done", "cancelled"].includes(issue.status)) {
    return false;
  }

  if (issue.status === "blocked") {
    return true;
  }

  const externalTime = toTime(issue.lastExternalCommentAt);
  const myTime = toTime(issue.myLastTouchAt);
  const assignedToBoard = issue.assigneeUserId === "local-board";

  if (externalTime > 0) {
    return externalTime >= myTime;
  }

  if (issue.isUnreadForMe) {
    return true;
  }

  return assignedToBoard && myTime === 0;
}

export function issueIsSent(issue: InboxLikeIssue): boolean {
  if (["done", "cancelled"].includes(issue.status)) {
    return false;
  }

  return !issueNeedsReply(issue) && toTime(issue.myLastTouchAt) > 0;
}
