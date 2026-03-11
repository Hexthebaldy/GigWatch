interface IconProps {
  size?: number;
  className?: string;
}

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 页面骨架图标：竖线将矩形分成约 2:8，表示 sidebar 折叠/展开 */
export const LayoutSidebar = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 20 14" {...base} strokeWidth={1.5} className={className}>
    <rect x="0.75" y="0.75" width="18.5" height="12.5" rx="1.5" />
    <line x1="5" y1="0.75" x2="5" y2="13.25" />
  </svg>
);

export const Calendar = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.5} className={className}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export const Bell = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.5} className={className}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const Close = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2} className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
