import React from "react";
import * as Icons from "@wix/wix-ui-icons-common";

// Map icon names to their components
export const AVAILABLE_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  User: Icons.User,
  Users: Icons.Users,
  StatusComplete: Icons.StatusComplete,
  Star: Icons.Star,
  Chat: Icons.Chat,
  Settings: Icons.Settings,
  Code: Icons.Code,
  Edit: Icons.Edit,
  Search: Icons.Search,
  Image: Icons.Image,
  Video: Icons.Video,
  Mail: Icons.Mail,
  Phone: Icons.Phone,
  Calendar: Icons.Calendar,
  Clock: Icons.Clock,
  Cart: Icons.Cart,
  CreditCard: Icons.CreditCard,
  Location: Icons.Location,
  Home: Icons.Home,
  Dashboard: Icons.Dashboard,
  Chart: Icons.Chart,
  Statistics: Icons.Statistics,
  Target: Icons.Target,
  Trophy: Icons.Trophy,
  Badge: Icons.Badge,
  Bell: Icons.Bell,
  Bookmark: Icons.Bookmark,
  Camera: Icons.Camera,
  Document: Icons.Document,
  Folder: Icons.Folder,
  Gift: Icons.Gift,
  Heart: Icons.Heart,
  Link: Icons.Link,
  Lock: Icons.Lock,
  Menu: Icons.Menu,
  Music: Icons.Music,
  Notification: Icons.Notification,
  Print: Icons.Print,
  Refresh: Icons.Refresh,
  Share: Icons.Share,
  Tag: Icons.Tag,
  Upload: Icons.Upload,
  Download: Icons.Download,
  Lightbulb: Icons.Lightbulb,
  Rocket: Icons.Rocket,
  Megaphone: Icons.Megaphone,
  Facebook: Icons.Facebook,
  Twitter: Icons.Twitter,
  Instagram: Icons.Instagram,
  Youtube: Icons.Youtube,
  Linkedin: Icons.Linkedin,
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
