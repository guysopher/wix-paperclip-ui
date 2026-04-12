"use client";

import { Providers } from "../providers";
import { DashboardGate } from "./dashboard-gate";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <DashboardGate>{children}</DashboardGate>
    </Providers>
  );
}
