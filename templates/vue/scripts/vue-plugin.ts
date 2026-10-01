import { createHash } from "node:crypto";
import { relative } from "node:path";
import { compileScript, parse } from "@vue/compiler-sfc";
import type { BunPlugin } from "bun";

/**
 * Single-file components: `<script setup>` with the template compiled inline.
 * Style with Tailwind classes; `<style>` blocks are not bundled. Used by the
 * browser bundle (`scripts/build.ts`) and by server rendering
 * (`bootstrap/inertia-ssr.ts`).
 */
export const vue: BunPlugin = {
  name: "vue-sfc",
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const { descriptor, errors } = parse(await Bun.file(path).text(), { filename: path });
      if (errors.length > 0) throw errors[0];
      if (descriptor.styles.length > 0) {
        throw new Error(`${relative(process.cwd(), path)}: <style> blocks are not bundled; use Tailwind classes.`);
      }
      const id = createHash("sha256").update(path).digest("hex").slice(0, 8);
      const script = compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: "__sfc__" });
      return {
        contents: `${script.content}\nexport default __sfc__;\n`,
        loader: descriptor.scriptSetup?.lang === "ts" || descriptor.script?.lang === "ts" ? "ts" : "js",
      };
    });
  },
};
