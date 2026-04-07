import React, { useState } from "react";
import { Box, Text, Input, Button, Modal, CustomModalLayout } from "@wix/design-system";
import { AVAILABLE_ICONS, AgentAvatar } from "./agent-avatar";

interface IconPickerProps {
  selectedIcon: string | undefined;
  onSelect: (icon: string | undefined) => void;
  avatarColor: string;
  agentName?: string;
  agentRole?: string;
}

export function IconPicker({ selectedIcon, onSelect, avatarColor, agentName = "Agent", agentRole }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const iconNames = Object.keys(AVAILABLE_ICONS);
  const filtered = search
    ? iconNames.filter((name) => name.toLowerCase().includes(search.toLowerCase()))
    : iconNames;

  const handleSelect = (icon: string) => {
    onSelect(icon);
    setIsOpen(false);
    setSearch("");
  };

  const handleClear = () => {
    onSelect(undefined);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <>
      {/* Click trigger - shows current icon */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 16px",
          borderRadius: "8px",
          border: "1px solid #e0e0e0",
          background: "#f7f8fa",
          cursor: "pointer",
          transition: "all 0.15s ease",
          width: "fit-content",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#3899ec";
          e.currentTarget.style.background = "#f0f7ff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#e0e0e0";
          e.currentTarget.style.background = "#f7f8fa";
        }}
      >
        <AgentAvatar
          agentName={agentName}
          agentRole={agentRole}
          icon={selectedIcon}
          size={40}
          fontSize={16}
        />
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#162d3d" }}>
            {selectedIcon || "No icon"}
          </div>
          <div style={{ fontSize: "11px", color: "#999" }}>
            Click to change
          </div>
        </div>
      </button>

      {/* Modal with icon grid */}
      <Modal
        isOpen={isOpen}
        onRequestClose={() => {
          setIsOpen(false);
          setSearch("");
        }}
        shouldCloseOnOverlayClick
      >
        <CustomModalLayout
          title="Choose an icon"
          subtitle={`${filtered.length} icon${filtered.length !== 1 ? "s" : ""} available`}
          primaryButtonText="Close"
          primaryButtonOnClick={() => {
            setIsOpen(false);
            setSearch("");
          }}
          secondaryButtonText={selectedIcon ? "Clear icon" : undefined}
          secondaryButtonOnClick={selectedIcon ? handleClear : undefined}
          onCloseButtonClick={() => {
            setIsOpen(false);
            setSearch("");
          }}
        >
          <Box direction="vertical" gap="12px">
            <Input
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search icons..."
              clearButton
              onClear={() => setSearch("")}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))",
                gap: "8px",
                maxHeight: "400px",
                overflowY: "auto",
                padding: "4px",
              }}
            >
              {filtered.map((iconName) => {
                const IconComponent = AVAILABLE_ICONS[iconName];
                const isSelected = selectedIcon === iconName;

                return (
                  <button
                    key={iconName}
                    onClick={() => handleSelect(iconName)}
                    title={iconName}
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "8px",
                      background: isSelected ? avatarColor : "#f7f7f7",
                      color: isSelected ? "white" : "#162d3d",
                      border: isSelected ? `2px solid ${avatarColor}` : "2px solid transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      padding: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = "#e8e8e8";
                        e.currentTarget.style.borderColor = "#ddd";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = "#f7f7f7";
                        e.currentTarget.style.borderColor = "transparent";
                      }
                    }}
                  >
                    <IconComponent style={{ width: 28, height: 28 }} />
                  </button>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <Box align="center" padding="40px">
                <Text size="small" secondary>
                  No icons found
                </Text>
              </Box>
            )}
          </Box>
        </CustomModalLayout>
      </Modal>
    </>
  );
}
