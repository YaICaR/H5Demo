import { defineConfig } from "vite";

export default defineConfig({
  base: "/H5Demo/",
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
