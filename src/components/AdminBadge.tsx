// App-icon badge marking an admin. Hover reveals an "Admin" tooltip.
export default function AdminBadge({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span className={`admin-badge relative inline-flex shrink-0 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="Admin" className="h-full w-full rounded-full object-cover" />
      <span className="admin-tooltip">Admin</span>
    </span>
  );
}
