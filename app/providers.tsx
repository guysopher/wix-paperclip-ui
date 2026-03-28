"use client";

import { WixDesignSystemProvider } from "@wix/design-system";

export function Providers({ children }: { children: React.ReactNode }) {
  return <WixDesignSystemProvider>{children}</WixDesignSystemProvider>;
}
