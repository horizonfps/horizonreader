"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavActive } from "@/lib/nav";

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.mobileOnly && (!i.adminOnly || isAdmin));

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <Link href="/" className="flex h-14 items-center gap-2.5 px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" className="h-7 w-7" />
        <span className="text-[15px] font-semibold tracking-tight text-text">HorizonReader</span>
      </Link>
      <nav className="mt-2 flex-1 px-3">
        <ul className="space-y-0.5">
          {items.map(({ href, label, Icon, plain }) => {
            const active = isNavActive(href, pathname);
            const className = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "bg-accent/15 font-medium text-accent" : "text-muted hover:bg-elevated hover:text-text"
            }`;
            const body = (
              <>
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </>
            );
            return (
              <li key={href}>
                {plain ? (
                  <a href={href} className={className}>
                    {body}
                  </a>
                ) : (
                  <Link href={href} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
