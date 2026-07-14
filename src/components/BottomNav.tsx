"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, Search, Bookmark, User } from "lucide-react";

const items = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/browse", label: "Browse", Icon: Compass },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/library", label: "Library", Icon: Bookmark },
  { href: "/profile", label: "Profile", Icon: User },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
      <ul
        className="mx-auto flex max-w-app"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {items.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
