import { Home, Compass, Search, Bookmark, Download, User, Activity } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  Icon: typeof Home;
  mobileOnly?: boolean;
  adminOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Início", Icon: Home },
  { href: "/browse", label: "Explorar", Icon: Compass },
  { href: "/search", label: "Buscar", Icon: Search, mobileOnly: true },
  { href: "/library", label: "Biblioteca", Icon: Bookmark },
  { href: "/downloads", label: "Downloads", Icon: Download },
  { href: "/profile", label: "Perfil", Icon: User },
  { href: "/info", label: "Infra", Icon: Activity, adminOnly: true },
];

export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
