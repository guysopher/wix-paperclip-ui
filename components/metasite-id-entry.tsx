"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Card, Heading, Input, Text } from "@wix/design-system";
import { type Company } from "@/lib/api";
import { isValidMsid, normalizeMsid, withCompanyId, withMsid } from "@/lib/msid";

interface Props {
  description?: string;
  createNewSiteDescription?: string;
  createNewSitePath?: string;
  existingCompanies?: Company[];
  initialValue?: string | null;
  onCreateNewSite?: () => void;
  onSelectExistingCompany?: (companyId: string) => void;
  redirectPath?: string;
  title?: string;
}

export function MetasiteIdEntry({
  description = "This UI needs an msid value to know which Wix business context to open.",
  createNewSiteDescription = "Start from scratch and let the AI Team Lead interview you briefly before kicking off the first site build.",
  createNewSitePath,
  existingCompanies = [],
  initialValue,
  onCreateNewSite,
  onSelectExistingCompany,
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
  const visibleCompanies = useMemo(
    () =>
      existingCompanies
        .filter((company) => company.status !== "archived")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [existingCompanies],
  );

  const handleSubmit = () => {
    if (!normalizedMsid) {
      return;
    }

    router.replace(withMsid(targetPath, normalizedMsid));
  };

  const handleCreateNewSite = () => {
    if (onCreateNewSite) {
      onCreateNewSite();
      return;
    }

    if (createNewSitePath) {
      router.push(createNewSitePath);
    }
  };

  const handleSelectExistingCompany = (companyId: string) => {
    if (onSelectExistingCompany) {
      onSelectExistingCompany(companyId);
      return;
    }

    router.push(withCompanyId("/", companyId));
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
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          borderRadius: 28,
          background: "rgba(255,255,255,0.94)",
          boxShadow: "0 28px 70px rgba(5, 18, 32, 0.28)",
          border: "1px solid rgba(255,255,255,0.35)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Card>
          <Card.Content>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    borderRadius: 999,
                    background: "rgba(47, 111, 237, 0.1)",
                    color: "#2f6fed",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    marginBottom: 14,
                  }}
                >
                  Open your AI Team
                </div>
                <Heading size="large">{title}</Heading>
                <Text secondary style={{ marginTop: 10, display: "block", fontSize: 15, lineHeight: 1.6 }}>
                  {description}
                </Text>
                <Text secondary style={{ marginTop: 8, display: "block", fontSize: 14, lineHeight: 1.6 }}>
                  Paste either the raw metasite ID or a Wix dashboard URL and I’ll extract it for you.
                </Text>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: 18,
                  borderRadius: 18,
                  background: "rgba(244, 248, 252, 0.92)",
                  border: "1px solid #dfe8f2",
                }}
              >
                <Text size="small" weight="bold" style={{ display: "block", marginBottom: 0, color: "#243b53" }}>
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
                <Button onClick={handleSubmit} disabled={!isValidMsid(trimmed)} size="medium">
                  Continue
                </Button>
              </div>

              <div
                style={{
                  height: 1,
                  background: "linear-gradient(90deg, rgba(208,220,234,0) 0%, rgba(208,220,234,1) 50%, rgba(208,220,234,0) 100%)",
                }}
              />

              {visibleCompanies.length > 0 && (
                <>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      padding: 18,
                      borderRadius: 18,
                      background: "rgba(244, 248, 252, 0.92)",
                      border: "1px solid #dfe8f2",
                    }}
                  >
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#17324a" }}>
                      Open an existing AI Team
                    </div>
                    <Text secondary style={{ fontSize: 14, lineHeight: 1.6 }}>
                      Pick one of the workspaces that already exists in Paperclip.
                    </Text>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {visibleCompanies.map((company) => (
                        <button
                          key={company.id}
                          onClick={() => handleSelectExistingCompany(company.id)}
                          style={{
                            width: "100%",
                            border: "1px solid #dfe8f2",
                            borderRadius: 14,
                            background: "white",
                            padding: "14px 16px",
                            textAlign: "left",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 14,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                color: "#17324a",
                                marginBottom: 4,
                              }}
                            >
                              {company.name}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#6b7c93",
                                wordBreak: "break-all",
                              }}
                            >
                              {company.id}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: "#2f6fed",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Open
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      height: 1,
                      background:
                        "linear-gradient(90deg, rgba(208,220,234,0) 0%, rgba(208,220,234,1) 50%, rgba(208,220,234,0) 100%)",
                    }}
                  />
                </>
              )}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: 18,
                  borderRadius: 18,
                  background: "linear-gradient(135deg, rgba(140, 76, 246, 0.08) 0%, rgba(47, 111, 237, 0.05) 100%)",
                  border: "1px solid rgba(140, 76, 246, 0.16)",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, color: "#17324a" }}>Create a new site</div>
                <Text secondary style={{ fontSize: 14, lineHeight: 1.6 }}>
                  {createNewSiteDescription}
                </Text>
                <div>
                  <Button skin="premium" onClick={handleCreateNewSite}>
                    Create a new site
                  </Button>
                </div>
              </div>
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
