import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { localApiToken } from "./server/localSecurity.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiPort = Number(process.env.PORT || env.PORT || 8787);
  if (env.APP_API_TOKEN) process.env.APP_API_TOKEN = env.APP_API_TOKEN;
  const apiToken = localApiToken();
  const securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
  const developmentSecurityHeaders = {
    ...securityHeaders,
    // Il client di sviluppo Vite inserisce il preambolo React Refresh inline.
    // La build servita da `npm start` mantiene invece la CSP più restrittiva.
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
  return {
    plugins: [react()],
    build: { chunkSizeWarningLimit: 700 },
    server: {
      host: "127.0.0.1",
      port: 5173,
      headers: developmentSecurityHeaders,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          headers: { "x-seogrow-token": apiToken },
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 5173,
      headers: securityHeaders,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          headers: { "x-seogrow-token": apiToken },
        },
      },
    },
  };
});
