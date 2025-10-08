import fs from "node:fs/promises";
import path from "node:path";
import diff from "deep-diff";

async function compareJsonFiles() {
  const file1Path = process.argv[2];
  const file2Path = process.argv[3];

  if (!file1Path || !file2Path) {
    console.error("Usage: pnpm diff <file1.json> <file2.json>");
    process.exit(1);
  }

  try {
    const json1 = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), file1Path), "utf-8")
    );
    const json2 = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), file2Path), "utf-8")
    );

    const differences = diff(json1, json2);

    if (!differences) {
      console.log("✅ JSON files are identical.");
    } else {
      console.log("❌ JSON files have differences:");
      console.log(JSON.stringify(differences, null, 2));
    }
  } catch (error) {
    console.error("Error comparing JSON files:", (error as Error).message);
    process.exit(1);
  }
}

compareJsonFiles();
