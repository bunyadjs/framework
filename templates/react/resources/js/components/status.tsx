export default function Status({ message }: { message?: string | null }) {
  return message ? (
    <div role="status" className="alert alert-success alert-soft text-sm">{message}</div>
  ) : null;
}
