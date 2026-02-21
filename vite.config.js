import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  build: {
    lib: {
      entry: "src/index.js",
      name: "DevPulse",
      fileName: (format) => `devpulse.${format}.js`,
      formats: ["es", "umd"],
    },
    rollupOptions: {
      external: [], // zero dependencies
    },
    minify: true,
    target: "es2015",
    outDir: "dist",
    sourcemap: true,
  },
});
