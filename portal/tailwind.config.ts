import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#F26624", dark: "#d4561e" },
      },
    },
  },
  plugins: [],
};

export default config;
