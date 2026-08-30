// Design-system tokens shared across admin/staff/web (mirrored into each
// app's tailwind.config so class names like bg-brand-primary work everywhere).

export const COLORS = {
  primary: "#2563EB",
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",
  bgPage: "#F8F9FA",
  bgCard: "#FFFFFF",
  bgSidebar: "#F1F3F5",
  border: "#E5E7EB",
} as const;

export const SIDEBAR_WIDTH = 200;
export const TOPBAR_HEIGHT = 52;
