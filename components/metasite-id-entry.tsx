"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Card, Heading, Input, Text } from "@wix/design-system";
import { isValidMsid, normalizeMsid, withMsid } from "@/lib/msid";

interface Props {
  description?: string;
  initialValue?: string | null;
  redirectPath?: string;
  title?: string;
}

export function MetasiteIdEntry({
  description = "This UI needs an msid value to know which Wix business context to open.",
  initialValue,
  redirectPath,
  title = "Enter an msid",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(() => normalizeMsid(initialValue) || "");

  const trimmed = value.trim();
  const showError = trimmed.length > 0 && !isValidMsid(trimmed);
  const targetPath = useMemo(() => redirectPath || pathname || "/", [pathname, redirectPath]);

  const handleSubmit = () => {
    if (!isValidMsid(trimmed)) {
      return;
    }

    router.replace(withMsid(targetPath, trimmed));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "linear-gradient(135deg, #0f1e2d 0%, #162d3d 45%, #1e4764 100%)",
      }}
    >
      <Card>
        <Card.Content>
          <div style={{ width: 420, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Heading size="medium">{title}</Heading>
              <Text secondary style={{ marginTop: 8, display: "block" }}>
                {description}
              </Text>
            </div>

            <div>
              <Text size="small" weight="bold" style={{ display: "block", marginBottom: 8 }}>
                msid
              </Text>
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Paste the msid value"
                status={showError ? "error" : undefined}
              />
              {showError && (
                <Text size="small" skin="error" style={{ marginTop: 8, display: "block" }}>
                  Enter a non-empty msid value.
                </Text>
              )}
            </div>

            <Button onClick={handleSubmit} disabled={!isValidMsid(trimmed)}>
              Continue
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}
