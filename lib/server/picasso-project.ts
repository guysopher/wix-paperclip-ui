import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WIX_PROJECTS_API_BASE = "https://www.wix.com/_api/projects";

type VerifiedPicassoStatus = "succeeded" | "incomplete" | "infrastructure_failed";

interface SiteAuthRecord {
  accessToken?: string;
}

interface PicassoProjectRecord {
  id?: string | null;
  siteUrl?: string | null;
  primarySiteUrl?: string | null;
  initialGenerationCompleted?: boolean | null;
}

interface PicassoProjectResponse {
  picassoProject?: PicassoProjectRecord;
}

interface DevMachineStatusResponse {
  status?: {
    status?: string;
  };
  details?: {
    applicationError?: {
      code?: string;
    };
  };
  message?: string;
}

export interface PicassoProjectVerification {
  siteId: string;
  verified: boolean;
  effectiveStatus: VerifiedPicassoStatus;
  projectId?: string;
  siteUrl?: string;
  primarySiteUrl?: string;
  initialGenerationCompleted?: boolean;
  devMachineStatus?: string;
  incompleteReason?: string;
}

function authFilePath(siteId: string) {
  return path.join(os.homedir(), ".wix", "auth", `site.${siteId}.json`);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizePublicUrl(value: unknown): string | undefined {
  const raw = getString(value);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function readSiteAccessToken(siteId: string) {
  const raw = await readFile(authFilePath(siteId), "utf8");
  const parsed = JSON.parse(raw) as SiteAuthRecord;
  const accessToken = getString(parsed.accessToken);
  if (!accessToken) {
    throw new Error(`Missing access token in local Wix auth for site ${siteId}`);
  }
  return accessToken;
}

async function fetchWixJson<T>(pathname: string, accessToken: string): Promise<T> {
  const response = await fetch(`${WIX_PROJECTS_API_BASE}${pathname}`, {
    headers: {
      Authorization: accessToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(`Wix projects API request failed: ${response.status} ${pathname}`);
    (error as Error & { status?: number; data?: unknown }).status = response.status;
    (error as Error & { status?: number; data?: unknown }).data = data;
    throw error;
  }

  return data as T;
}

function getErrorCode(error: unknown): string | undefined {
  const data = (error as { data?: DevMachineStatusResponse })?.data;
  return getString(data?.details?.applicationError?.code);
}

function getErrorMessage(error: unknown): string | undefined {
  const data = (error as { data?: DevMachineStatusResponse })?.data;
  return (
    getString(data?.message) ||
    getString((error as Error | undefined)?.message)
  );
}

function isInfrastructureFailure(code: string | undefined, message: string | undefined) {
  if (code === "DEV_MACHINE_NOT_FOUND") {
    return true;
  }

  const normalized = message?.toLowerCase() || "";
  return (
    normalized.includes("no remote machine signed instance found") ||
    normalized.includes("dev machine not found") ||
    normalized.includes("dev machine session not found")
  );
}

export async function verifyPicassoProject(siteId: string): Promise<PicassoProjectVerification> {
  const accessToken = await readSiteAccessToken(siteId);
  const project = await fetchWixJson<PicassoProjectResponse>(
    "/v1/picasso-projects/me",
    accessToken,
  );

  let devMachineStatus: string | undefined;
  let devMachineErrorCode: string | undefined;
  let devMachineErrorMessage: string | undefined;

  try {
    const devMachine = await fetchWixJson<DevMachineStatusResponse>(
      "/v1/picasso-projects/dev-machine-status",
      accessToken,
    );
    devMachineStatus = getString(devMachine.status?.status);
  } catch (error) {
    devMachineErrorCode = getErrorCode(error);
    devMachineErrorMessage = getErrorMessage(error);
  }

  const picassoProject = project.picassoProject;
  const initialGenerationCompleted = picassoProject?.initialGenerationCompleted === true;
  const projectId = getString(picassoProject?.id);
  const siteUrl = normalizePublicUrl(picassoProject?.siteUrl);
  const primarySiteUrl = normalizePublicUrl(picassoProject?.primarySiteUrl);

  if (initialGenerationCompleted) {
    return {
      siteId,
      verified: true,
      effectiveStatus: "succeeded",
      projectId,
      siteUrl,
      primarySiteUrl,
      initialGenerationCompleted: true,
      devMachineStatus,
    };
  }

  const infrastructureFailure = isInfrastructureFailure(
    devMachineErrorCode,
    devMachineErrorMessage,
  );

  return {
    siteId,
    verified: true,
    effectiveStatus: infrastructureFailure ? "infrastructure_failed" : "incomplete",
    projectId,
    siteUrl,
    primarySiteUrl,
    initialGenerationCompleted: picassoProject?.initialGenerationCompleted === false ? false : undefined,
    devMachineStatus,
    incompleteReason:
      devMachineErrorMessage ||
      "Picasso project exists, but initial generation is not complete yet.",
  };
}
