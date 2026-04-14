"use client";

import { Box, Loader } from "@wix/design-system";
import { useCompany } from "../providers";
import { Shell } from "../shell";
import { MetasiteIdEntry } from "@/components/metasite-id-entry";

export function DashboardGate({ children }: { children: React.ReactNode }) {
  const { companyLookupStatus, msid } = useCompany();

  if (companyLookupStatus === "missing-msid") {
    return (
      <MetasiteIdEntry
        title="Open or create your Wix site"
        description="Open an existing Wix business by pasting its metasite ID or manage URL."
        createNewSitePath="/new?mode=new_site"
        createNewSiteDescription="Start from scratch and let the AI Team Lead kick off the first site build."
      />
    );
  }

  if (companyLookupStatus === "company-missing") {
    return (
      <MetasiteIdEntry
        title="No AI Team found for this msid"
        description="This metasite is not currently mapped to an AI Team workspace. Continue will explicitly start or reconnect a workspace for this exact metasite instead of silently creating one."
        createNewSitePath="/new?mode=new_site"
        createNewSiteDescription="Use this only if you want a brand new site build. It should not be used to recover an existing Wix business context."
        initialValue={msid}
        redirectPath="/new"
      />
    );
  }

  if (companyLookupStatus === "loading") {
    return (
      <Box align="center" verticalAlign="middle" height="100vh">
        <Loader size="medium" />
      </Box>
    );
  }

  return <Shell>{children}</Shell>;
}
