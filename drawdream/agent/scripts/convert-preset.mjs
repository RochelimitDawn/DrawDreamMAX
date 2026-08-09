// ST é¢è®¾è½¬æ¢å?CLIï¼node scripts/convert-preset.mjs <STé¢è®¾.json> [è¾åº=drawdream-preset.json]
// è¾åºï¼æä»¬èªå·±ç drawdream-preset.json + ç»æååè¯æ¥åï¼åªååå/å»å/é¿åº¦ï¼åå®¹ä¸å¤æ¾ââåå®¹ä¸­ç«åè®®ï¼
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { convertStPreset } from "../src/preset.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg) {
	console.error("ç¨æ³ï¼node scripts/convert-preset.mjs <STé¢è®¾.json> [è¾åºè·¯å¾=drawdream-preset.json]");
	process.exit(1);
}
const inputPath = isAbsolute(inputArg) ? inputArg : join(appDir, inputArg);
const outputPath = isAbsolute(outputArg ?? "") ? outputArg : join(appDir, outputArg ?? "drawdream-preset.json");

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const presetName = basename(inputPath).replace(/\.json$/i, "");
const { preset, report } = convertStPreset(raw, presetName);

writeFileSync(outputPath, JSON.stringify(preset, null, "\t"), "utf8");

console.log(`\né¢è®¾è½¬æ¢æ¥åï¼?{presetName}`);
console.log("â".repeat(72));
for (const r of report) {
	const chars = r.contentChars > 0 ? `${r.contentChars} å­ç¬¦` : "";
	console.log(`  ${r.action.padEnd(14)} ${r.name || r.identifier}  ${chars}`);
}
console.log("â".repeat(72));
const count = (a) => report.filter((r) => r.action === a).length;
console.log(
	`system åºå ${count("system")} Â· æ«ç«¯åºå ${count("postHistory")} Â· marker å¼?${count("markerï¼æ§½ä½ï¼å¼ï¼")} Â· ç¦ç¨ä¿ç ${count("ç¦ç¨ï¼ä¿çå¯å¼å¯ï¼")} Â· ç¼ºå¤± ${count("ç¼ºå¤±å®ä¹")}`,
);
console.log(`éæ ·åæ°ï¼?{JSON.stringify(preset.samplers)}`);
console.log(`å·²åå?${outputPath}`);
console.log("\næç¤ºï¼å¨ drawdream.config.json å?\"preset\": \"drawdream-preset.json\" å¯ç¨ï¼ä¸éè¦çåæ enabled æ¹ä¸º falseã?);
console.log("åè¯å»ºè®®ï¼æºå¶è¡¥å¿ç±»åï¼ç¶ææ æä»¤/é²å¤è¯?CoT æ¨¡æ¿ï¼å»ºè®®ç¦ç¨ââå¶æå¾å·²ç±åºè®°/å®¡è®¡/æèééå®ç°ã?);
