import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      workbox: {
        // Sign-in returns to "/?code=..."; the SPA fallback must serve the app for that,
        // but must never answer for anything that isn't an app route.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/auth\//, /^\/\.netlify\//, /^\/api\//],
        runtimeCaching: [
          {
            // Auth tokens and routine data must always come from the network. A cached
            // session or a stale day log is the worst bug this app could ship.
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkOnly",
          },
          {
            // Google account avatars — nice to have offline, never worth a failed render.
            urlPattern: ({ url }) => /googleusercontent\.com$/.test(url.hostname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "glass-avatars",
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: "Glass",
        short_name: "Glass",
        description: "AM/PM skincare routine tracker",
        theme_color: "#0A0705",
        background_color: "#0A0705",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        // Keeps the OAuth round trip inside the installed app instead of bouncing the
        // user out to Safari when Google redirects back.
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    open: false,
    // lets the localtunnel/ngrok hostname through during phone testing over a public tunnel
    allowedHosts: true,
  },
});
