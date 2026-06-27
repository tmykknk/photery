/** @type {import("prettier").Config} */
const config = {
  plugins: [
    "prettier-plugin-tailwindcss",
    "prettier-plugin-classnames",
    "prettier-plugin-merge",
  ],
  overrides: [
    {
      files: ["*.md", "*.mdx"],
      options: {
        plugins: [],
      },
    },
  ],
};

export default config;
