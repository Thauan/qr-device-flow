import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/storage/memory.ts", "src/express.ts"],
  format: "esm",
  dts: false,
  clean: true,
});
