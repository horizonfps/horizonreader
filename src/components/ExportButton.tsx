import { Download } from "lucide-react";

export default function ExportButton() {
  return (
    <a
      href="/api/export"
      download
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-elevated"
    >
      <Download className="h-4 w-4" />
      Exportar .xlsx
    </a>
  );
}
