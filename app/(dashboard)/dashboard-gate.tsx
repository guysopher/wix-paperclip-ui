"use client";

import { useEffect } from "react";
import { Box, Loader } from "@wix/design-system";
import { useRouter } from "next/navigation";
import { useCompany } from "../providers";
import { Shell } from "../shell";
import { MetasiteIdEntry } from "@/components/metasite-id-entry";
import { withMsid } from "@/lib/msid";

export function DashboardGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { companyLookupStatus, msid } = useCompany();

  useEffect(() => {
    if (companyLookupStatus === "company-missing" && msid) {
      router.replace(withMsid("/new", msid));
    }
  }, [companyLookupStatus, msid, router]);

  if (companyLookupStatus === "missing-msid") {
    return (
      <MetasiteIdEntry description="Paste the Paperclip company ID you want this business manager to operate on." />
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
