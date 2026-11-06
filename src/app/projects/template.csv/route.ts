import { TEMPLATE_CSV } from "@/lib/importer";

export function GET() {
  return new Response(TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="scopeflow-scope-template.csv"',
    },
  });
}
