import type { Config } from "tailwindcss";

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("--bg"),
        surface: rgb("--surface"),
        elevated: rgb("--elevated"),
        border: rgb("--border"),
        text: rgb("--text"),
        muted: rgb("--muted"),
        accent: rgb("--accent"),
        "accent-hover": rgb("--accent-hover"),
        "on-accent": rgb("--on-accent"),
      },
      maxWidth: {
        app: "48rem",
      },
    },
  },
  plugins: [],
};

export default config;
