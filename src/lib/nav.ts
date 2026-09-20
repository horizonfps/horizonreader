import { Home, Compass, Search, Bookmark, History, Download, Shuffle, User, Activity } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  Icon: typeof Home;
  mobileOnly?: boolean;
  desktopOnly?: boolean;
  adminOnly?: boolean;
  // Route handlers redirect; a plain anchor skips the router prefetch.
  plain?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Início", Icon: Home },
  { href: "/browse", label: "Explorar", Icon: Compass },
  { href: "/search", label: "Buscar", Icon: Search, mobileOnly: true },
  { href: "/library", label: "Biblioteca", Icon: Bookmark },
  { href: "/history", label: "Histórico", Icon: History, desktopOnly: true },
  { href: "/downloads", label: "Downloads", Icon: Download },
  { href: "/random", label: "Obra aleatória", Icon: Shuffle, desktopOnly: true, plain: true },
  { href: "/profile", label: "Perfil", Icon: User },
  { href: "/info", label: "Infra", Icon: Activity, adminOnly: true },
];

export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
