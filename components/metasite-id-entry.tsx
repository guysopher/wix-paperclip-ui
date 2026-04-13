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
  const [value, setValue] = useState(() => initialValue || "");

  const trimmed = value.trim();
  const normalizedMsid = normalizeMsid(trimmed);
  const showError = trimmed.length > 0 && !normalizedMsid;
  const targetPath = useMemo(() => redirectPath || pathname || "/", [pathname, redirectPath]);

  const handleSubmit = () => {
    if (!normalizedMsid) {
      return;
    }

    router.replace(withMsid(targetPath, normalizedMsid));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: "#183247",
        backgroundImage: "linear-gradient(rgba(24, 50, 71, 0.9), rgba(24, 50, 71, 0.9)), url('/ai-team-background.png')",
        backgroundRepeat: "repeat",
        backgroundSize: "540px auto",
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
              <Text secondary style={{ marginTop: 6, display: "block" }}>
                You can paste either the raw metasite ID or a Wix dashboard URL.
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
                placeholder="Paste the msid or Wix dashboard URL"
                status={showError ? "error" : undefined}
              />
              {showError && (
                <Text size="small" skin="error" style={{ marginTop: 8, display: "block" }}>
                  Enter a valid metasite ID or paste a Wix dashboard URL that contains one.
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
