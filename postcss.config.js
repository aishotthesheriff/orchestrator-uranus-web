import postcss from "postcss";

// TailwindCSS <=3.4.17 calls `postcss.parse` without providing a `from` option.
// PostCSS 8.5 warns about this (and may mis-handle imported assets), so we
// shim in a default `from` value when none is supplied.
if (!postcss.__uranusPatchedParse) {
  const originalParse = postcss.parse;
  postcss.parse = (css, opts = {}) => {
    const nextOpts = opts ? { ...opts } : {};
    if (nextOpts.from == null) {
      nextOpts.from = "tailwindcss/preflight.css";
    }
    return originalParse(css, nextOpts);
  };
  postcss.__uranusPatchedParse = true;
}

export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
