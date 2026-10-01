import { usePage } from "@inertiajs/react";
import type { SharedData } from "@/types";

export default function AppLogo() {
  const { name } = usePage<SharedData>().props;

  return (
    <span className="flex items-center gap-2 font-semibold">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-content">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden="true">
          <path d="M3 21V9l9-6 9 6v12h-6v-7H9v7H3Z" />
        </svg>
      </span>
      <span>{name}</span>
    </span>
  );
}
