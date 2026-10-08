import fs from "node:fs";
import path from "node:path";

const directory = "supabase/migrations";
const files = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const failures = [];
for (const name of files) {
  const sql = fs.readFileSync(path.join(directory, name), "utf8");
  if ((sql.match(/\$\$/g) ?? []).length % 2 !== 0) failures.push(name + ": unbalanced $$ quote");
  if (/\bas \$\s*$/m.test(sql)) failures.push(name + ": single-dollar function opening quote");
  if (/^\s*end\$;\s*$/m.test(sql)) failures.push(name + ": single-dollar function closing quote");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-bucket-migration-syntax: " + files.length + " migrations pass quote hygiene");
