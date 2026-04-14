"use client";

import { useEffect } from "react";
import { Box, Loader } from "@wix/design-system";
import { useRouter } from "next/navigation";
import { useCompany } from "../providers";
import { Shell } from "../shell";
import { MetasiteIdEntry } from "@/components/metasite-id-entry";
import { withWorkspaceContext } from "@/lib/msid";

export function DashboardGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { companyLookupStatus, msid } = useCompany();

  useEffect(() => {
    if (companyLookupStatus === "company-missing") {
      router.replace(
        withWorkspaceContext("/new", {
          msid,
        }),
      );
    }
  }, [companyLookupStatus, msid, router]);

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

  if (companyLookupStatus === "loading" || companyLookupStatus === "company-missing") {
    return (
      <Box align="center" verticalAlign="middle" height="100vh">
        <Loader size="medium" />
      </Box>
    );
  }

  return <Shell>{children}</Shell>;
}
