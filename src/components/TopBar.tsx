import Link from "next/link";
import { Search } from "lucide-react";

export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 h-12 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-full max-w-app items-center justify-between px-4">
        <Link href="/" aria-label="Início" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-7 w-7" />
        </Link>
        <Link
          href="/search"
          aria-label="Search"
          className="text-muted transition-colors hover:text-text"
        >
          <Search className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
