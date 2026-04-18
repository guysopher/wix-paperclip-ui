export const CEO_CHAT_DISCUSS_EVENT = "paperclip:ceo-chat-discuss";

export interface CeoChatDiscussDetail {
  companyId: string;
  text?: string;
  issueId?: string;
  mode?: "send" | "draft";
  taskRef?: string;
  requestText?: string;
}

export function openCeoChatDiscussion(detail: CeoChatDiscussDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CeoChatDiscussDetail>(CEO_CHAT_DISCUSS_EVENT, {
      detail,
    }),
  );
}
