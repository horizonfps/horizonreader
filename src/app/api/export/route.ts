import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { STATUS_LABELS } from "@/lib/cards";

export const runtime = "nodejs";

function parseGenres(raw: string | null): string {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.join(", ") : "";
  } catch {
    return "";
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let favorites: Prisma.FavoriteGetPayload<{ include: { work: true } }>[] = [];
  try {
    favorites = await prisma.favorite.findMany({
      where: { userId: session.uid },
      include: { work: true },
    });
  } catch {
    favorites = [];
  }

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Reading list");

    sheet.columns = [
      { header: "Title", key: "title", width: 40 },
      { header: "Type", key: "type", width: 12 },
      { header: "Status", key: "status", width: 14 },
      { header: "Current chapter", key: "chapter", width: 16 },
      { header: "Rating", key: "rating", width: 10 },
      { header: "Genres", key: "genres", width: 40 },
      { header: "Link", key: "link", width: 40 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    let chapterByWork = new Map<number, number>();
    try {
      const grouped = await prisma.progress.groupBy({
        by: ["workId"],
        where: { userId: session.uid, workId: { in: favorites.map((f) => f.workId) } },
        _max: { chapterNumber: true },
      });
      chapterByWork = new Map(
        grouped
          .filter((g) => g.workId != null && g._max.chapterNumber != null)
          .map((g) => [g.workId as number, g._max.chapterNumber as number]),
      );
    } catch {
      chapterByWork = new Map();
    }

    for (const f of favorites) {
      const work = f.work;
      const chapterNumber: number | "" = chapterByWork.get(f.workId) ?? "";

      sheet.addRow({
        title: work.title,
        type: work.type ?? "",
        status: STATUS_LABELS[f.status] ?? f.status,
        chapter: chapterNumber,
        rating: work.rating ?? "",
        genres: parseGenres(work.genres),
        link: "/work/" + work.slug,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="horizonreader-list.xlsx"',
      },
    });
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
