import Link from "next/link";
import { ChevronRight } from "lucide-react";

export default function SectionHeader({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="mr-1 text-base font-semibold tracking-tight text-text sm:text-lg">{title}</h2>
      {children}
      {href ? (
        <Link
          href={href}
          className="ml-auto flex items-center gap-0.5 text-xs text-muted transition-colors hover:text-text"
        >
          Ver todos
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}
