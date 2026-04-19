import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/storage/memory.ts"],
  format: "esm",
  dts: false,
  clean: true,
});
