import React from "react";
import {
  Dashboard,
  Users,
  Checklist,
  Chat,
  Inbox,
  Refresh,
  Confirm,
  Globe,
  Settings,
  Code,
  Feed,
  Add,
  Delete,
  ExternalLink,
  Send,
  Star,
  StarFilled,
  Search,
  Edit,
  More,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
  Duplicate,
  Download,
  Upload,
  Share,
  Filter,
  Sort,
  PlayFilled,
  PauseFilled,
  StopFilled,
  Help,
} from "@wix/wix-ui-icons-common";

// Map icon names to their components
export const AVAILABLE_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Dashboard,
  Users,
  Checklist,
  Chat,
  Inbox,
  Refresh,
  Confirm,
  Globe,
  Settings,
  Code,
  Feed,
  Add,
  Delete,
  ExternalLink,
  Send,
  Star,
  StarFilled,
  Search,
  Edit,
  More,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
  Duplicate,
  Download,
  Upload,
  Share,
  Filter,
  Sort,
  PlayFilled,
  PauseFilled,
  StopFilled,
  Help,
};

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
