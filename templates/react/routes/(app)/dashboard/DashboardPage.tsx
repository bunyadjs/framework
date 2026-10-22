import type { PageMeta } from "~/_types";

/** The title and text the layout around this page shows. */
export const meta: PageMeta = { title: "Dashboard" };

export default function Dashboard() {
  return (
    <>
      <div className="flex h-full flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((card) => (
            <div key={card} className="aspect-video rounded-box border border-dashed border-base-300 bg-base-100" />
          ))}
        </div>
        <div className="min-h-96 flex-1 rounded-box border border-dashed border-base-300 bg-base-100" />
      </div>
    </>
  );
}
