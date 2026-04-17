export const CEO_CHAT_DISCUSS_EVENT = "paperclip:ceo-chat-discuss";

export interface CeoChatDiscussDetail {
  companyId: string;
  text: string;
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
