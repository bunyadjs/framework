import AppLayout from "@/layouts/app-layout";

export default function Dashboard() {
  return (
    <AppLayout title="Dashboard">
      <div className="flex h-full flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((card) => (
            <div key={card} className="aspect-video rounded-box border border-dashed border-base-300 bg-base-100" />
          ))}
        </div>
        <div className="min-h-96 flex-1 rounded-box border border-dashed border-base-300 bg-base-100" />
      </div>
    </AppLayout>
  );
}
