import type { ComponentType } from "react";
import Login from "./Pages/Auth/Login";
import Register from "./Pages/Auth/Register";
import Dashboard from "./Pages/Auth/Dashboard";
import Feed from "./Pages/Feed";
import Welcome from "./Pages/Welcome";

export const pages: Record<string, ComponentType> = {
  "Auth/Login": Login,
  "Auth/Register": Register,
  "Auth/Dashboard": Dashboard,
  Feed,
  Welcome,
};

export function resolvePage(name: string): ComponentType {
  const page = pages[name];
  if (!page) {
    throw new Error(`Inertia page not found: ${name}`);
  }
  return page;
}
