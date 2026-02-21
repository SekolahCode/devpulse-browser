export default [
  {
    files: ["src/**/*.js"],
    rules: {
      "no-unused-vars": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: "error",
    },
  },
];
