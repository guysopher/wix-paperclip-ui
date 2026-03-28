"use client";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ color: "#b0b0b0" }}>/</span>}
          {item.href ? (
            <a href={item.href} style={{ color: "#3899ec", textDecoration: "none" }}>
              {item.label}
            </a>
          ) : (
            <span style={{ color: "#162d3d", fontWeight: 600 }}>{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
