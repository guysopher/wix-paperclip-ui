import type { Company } from "@/lib/api";

function replaceToken(template: string, token: string, value: string) {
  return template.replace(new RegExp(`\\{\\{\\s*${token.replace(".", "\\.")}\\s*\\}\\}`, "g"), value);
}

export function renderPromptTemplate(template: string, company: Pick<Company, "name" | "description"> | null | undefined) {
  let result = template;
  result = replaceToken(result, "company.name", company?.name?.trim() || "the company");
  result = replaceToken(result, "company.description", company?.description?.trim() || "");
  return result;
}

