const fs = require("fs");
const esbuild = require("esbuild");

const flags = process.argv.slice(2);

const esbuildConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode", "esbuild"],
  format: "cjs",
  platform: "node",
  sourcemap: flags.includes("--sourcemap"),
  minify: flags.includes("--minify"),
  metafile: true,
  plugins: [
    {
      name: "on-end-plugin",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error("Build failed with errors:", result.errors);
            throw new Error("esbuild failed");
          }
          try {
            fs.mkdirSync("build", { recursive: true });
            fs.writeFileSync(
              "./build/meta.json",
              JSON.stringify(result.metafile, null, 2),
            );
          } catch (e) {
            console.error("Failed to write esbuild meta file", e);
          }
          console.log("VS Code Lite Extension esbuild complete");
        });
      },
    },
  ],
};

void (async () => {
  await esbuild.build(esbuildConfig);
})();

