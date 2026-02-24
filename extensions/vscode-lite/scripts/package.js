const { exec } = require("child_process");
const fs = require("fs");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

const command = "npx @vscode/vsce package --out ./build --no-dependencies";

exec(command, (error) => {
  if (error) {
    throw error;
  }
  console.log(
    `vsce package completed - extension created at extensions/vscode-lite/build/continue-lite-autocomplete-${version}.vsix`,
  );
});

