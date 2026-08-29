const fs = require("fs");
const existing = JSON.parse(fs.readFileSync("lib/track-boundaries.json", "utf8"));
const bulkPath = "C:/Users/Vitor/AppData/Local/Temp/claude/C--Users-Vitor-Documents-iracing-analytics/82d84574-c448-44f7-92c4-1c0a58e92a7b/scratchpad/all-track-boundaries.json";
const bulk = JSON.parse(fs.readFileSync(bulkPath, "utf8"));
const merged = { ...existing };
let added = 0;
for (const [id, val] of Object.entries(bulk)) {
  if (!merged[id]) { merged[id] = val; added++; }
}
fs.writeFileSync("lib/track-boundaries.json", JSON.stringify(merged));
console.log("added:", added, "total track count:", Object.keys(merged).length, "size bytes:", fs.statSync("lib/track-boundaries.json").size);
