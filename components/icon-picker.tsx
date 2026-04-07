import React, { useState } from "react";
import { Box, Text, Input, Button } from "@wix/design-system";
import { AVAILABLE_ICONS } from "./agent-avatar";

interface IconPickerProps {
  selectedIcon: string | undefined;
  onSelect: (icon: string | undefined) => void;
  avatarColor: string;
}

export function IconPicker({ selectedIcon, onSelect, avatarColor }: IconPickerProps) {
  const [search, setSearch] = useState("");

  const iconNames = Object.keys(AVAILABLE_ICONS);
  const filtered = search
    ? iconNames.filter((name) => name.toLowerCase().includes(search.toLowerCase()))
    : iconNames;

  return (
    <Box direction="vertical" gap="12px">
      <Input
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search icons..."
      />

      {selectedIcon && (
        <Box direction="horizontal" gap="8px" verticalAlign="middle">
          <Text size="small" secondary>
            Current icon:
          </Text>
          <Button
            size="tiny"
            priority="secondary"
            onClick={() => onSelect(undefined)}
          >
            Clear icon
          </Button>
        </Box>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
          gap: "8px",
          maxHeight: "320px",
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
              onClick={() => onSelect(iconName)}
              title={iconName}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                background: isSelected ? avatarColor : "#f7f7f7",
                color: isSelected ? "white" : "#162d3d",
                border: isSelected ? `2px solid ${avatarColor}` : "2px solid transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.2s",
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
              <IconComponent style={{ width: 24, height: 24 }} />
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Box align="center" padding="24px">
          <Text size="small" secondary>
            No icons found
          </Text>
        </Box>
      )}

      <Text size="tiny" secondary>
        {filtered.length} icon{filtered.length !== 1 ? "s" : ""} available
      </Text>
    </Box>
  );
}
