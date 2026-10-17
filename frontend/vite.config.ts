import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Lets the viewer import sample files from ../data/samples.
    fs: { allow: [".."] },
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://localhost:8000" },
  },
  test: { environment: "node" },
});
