/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        "overpass-mono": ["var(--font-overpass-mono)", "Overpass Mono", "monospace"],
        "inconsolata": ["var(--font-inconsolata)", "Inconsolata", "monospace"],
      },
      objectPosition: {
        "top-33": "center top 33.33%",
        "top-50": "center top 50%",
      },
      backgroundPosition: {
        "center-33": "center 33.33%",
      },
      backgroundSize: {
        "size-66": "100% 66.67%",
      },
      typography: {
        "no-quotes": {
          css: {
            "blockquote p:first-of-type::before": {
              content: "none !important",
            },
            "blockquote p:last-of-type::after": {
              content: "none !important",
            },
          },
        },
      },
    },
    screens: {
      "sm": "800px",
      // => @media (min-width: 800px) { ... }
      "md": "1200px",
      // => @media (min-width: 1280px) { ... }
      "lg": "1900px",
      // => @media (min-width: 1920px) { ... }
      "xl": "2500px",
      // => @media (min-width: 2560px) { ... }
      "2xl": "3800px",
      // => @media (min-width: 3840px) { ... }
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
  ],
  darkMode: "class",
};
