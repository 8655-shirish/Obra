import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, "../../..");

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { "@": path.join(repository, "src") } },
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
});
