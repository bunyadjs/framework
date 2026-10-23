import type { ReactNode } from "react";

/**
 * Wraps every page. Put here what every page shares (a toast area, an analytics snippet);
 * the layouts of the folders below nest inside it.
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
