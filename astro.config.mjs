import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), icon({ include: { lucide: ["*"] } })],
  server: {
    port: 3000,
    host: true,
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ["argon2", "@prisma/adapter-pg", "pg", "nodemailer", "@react-pdf/renderer", "googleapis", "tsdav"],
    },
  },
  // `checkOrigin: true` blokuje POST requesty při deploy za Reverse Proxy,
  // protože server vidí request URL `http://localhost:3000` ale prohlížeč
  // posílá Origin `https://www.raseliniste.cz` → mismatch.
  // CSRF je v našem případě pokrytý sameSite=strict cookie a konstrukcí tokens.
  security: {
    checkOrigin: false,
  },
});
