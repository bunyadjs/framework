export default function Heading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {description && <p className="mt-1 text-sm text-base-content/70">{description}</p>}
    </div>
  );
}
