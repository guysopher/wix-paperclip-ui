"use client";

import { Suspense } from "react";
import { Providers } from "../providers";
import { DashboardGate } from "./dashboard-gate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f7f8fa" }} />}>
      <Providers>
        <DashboardGate>{children}</DashboardGate>
      </Providers>
    </Suspense>
  );
}
