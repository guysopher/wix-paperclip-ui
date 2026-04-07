import React from "react";
import * as WixIcons from "@wix/wix-ui-icons-common";

// Filter out TypeScript types and small/filled variants, keep only base icons
const getAvailableIcons = () => {
  const icons: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {};

  Object.keys(WixIcons).forEach((key) => {
    // Skip non-component exports (like __esModule, default, etc.)
    if (key.startsWith('_') || key === 'default') return;

    // Skip Small and Filled variants to avoid duplicates
    if (key.includes('Small') || key.includes('Filled')) return;

    const component = (WixIcons as Record<string, unknown>)[key];

    // Only include actual React components
    if (typeof component === 'function' || (component && typeof component === 'object')) {
      icons[key] = component as React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    }
  });

  return icons;
};

export const AVAILABLE_ICONS = getAvailableIcons();

interface AgentAvatarProps {
  agentName: string;
  agentRole?: string;
  icon?: string;
  size?: number;
  fontSize?: number;
}

export function AgentAvatar({ agentName, agentRole = "", icon, size = 38, fontSize = 16 }: AgentAvatarProps) {
  const avatarColor =
    agentRole === "ceo" ? "#3899ec" : agentRole === "pm" ? "#7b61ff" : "#44b5b0";

  const IconComponent = icon ? AVAILABLE_ICONS[icon] : null;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: avatarColor,
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: IconComponent ? undefined : fontSize,
        flexShrink: 0,
      }}
    >
      {IconComponent ? (
        <IconComponent style={{ width: size * 0.5, height: size * 0.5 }} />
      ) : (
        agentName.charAt(0).toUpperCase()
      )}
    </div>
  );
}
