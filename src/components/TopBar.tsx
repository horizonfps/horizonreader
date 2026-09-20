import Link from "next/link";
import { Search } from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";
import UserMenu from "@/components/UserMenu";

export type TopBarUser = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};

export default function TopBar({ user }: { user: TopBarUser }) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-bg/85 backdrop-blur lg:pl-60">
      <div className="mx-auto flex h-full max-w-app items-center gap-3 px-4">
        <Link href="/" aria-label="Início" className="flex items-center gap-2 lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-7 w-7" />
        </Link>
        <GlobalSearch className="hidden max-w-xl flex-1 md:block" />
        <div className="flex-1 md:hidden" />
        <Link
          href="/search"
          aria-label="Buscar"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:text-text md:hidden"
        >
          <Search className="h-5 w-5" />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <UserMenu
            username={user.username}
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            isAdmin={user.isAdmin}
          />
        </div>
      </div>
    </header>
  );
}
