// one-shot string rewrite for rest.ts / roleplay path renames
import { readFileSync, writeFileSync } from "node:fs";

const patch = (file, fn) => {
	let s = readFileSync(file, "utf8");
	const n = fn(s);
	writeFileSync(file, n);
	console.log("patched", file);
};

patch("server/rest.ts", (s) => {
	if (!s.includes("resolveConfigPath")) {
		s = s.replace(
			'import { RP_COMMANDS } from "../src/commands.ts";',
			'import { RP_COMMANDS } from "../src/commands.ts";\nimport { resolveConfigPath } from "../src/paths.ts";',
		);
	}
	s = s.replace(
		'const configPath = (cwd: string) => join(cwd, "drawdream.config.json");',
		"const configPath = (cwd: string) => resolveConfigPath(cwd);",
	);
	s = s.replaceAll(".drawdream-cache", ".drawdream-cache");
	s = s.replaceAll(".drawdream-uploads", ".drawdream-uploads");
	s = s.replaceAll(".drawdream-media", ".drawdream-media");
	s = s.replaceAll(".drawdream-skills", ".drawdream-skills");
	s = s.replaceAll("drawdream-preset.json", "drawdream-preset.json");
	s = s.replaceAll("drawdream.config.json", "drawdream.config.json");
	return s;
});

patch(".pi/extensions/roleplay.ts", (s) => {
	if (!s.includes('from "../../src/paths.ts"')) {
		s = s.replace(
			'import { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig, type WorldState } from "../../src/types.ts";',
			'import { dir, resolveConfigPath, DIRS } from "../../src/paths.ts";\nimport { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig, type WorldState } from "../../src/types.ts";',
		);
	}
	s = s.replaceAll('join(ctx.cwd, "drawdream.config.json")', "resolveConfigPath(ctx.cwd)");
	s = s.replaceAll('join(ctx.cwd, ".drawdream-state"', 'join(dir(ctx.cwd, "state")');
	// fix broken if above doubled join
	s = s.replaceAll(
		'stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`)',
		'stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`)',
	);
	// original form
	s = s.replace(
		/stateFile = join\(ctx\.cwd, "\.drawdream-state", `\$\{ctx\.sessionManager\.getSessionId\(\)\}\.json`\);/g,
		'stateFile = join(dir(ctx.cwd, "state"), `${ctx.sessionManager.getSessionId()}.json`);',
	);
	s = s.replace(
		/panelsFile = join\(ctx\.cwd, "\.drawdream-artifacts", `\$\{ctx\.sessionManager\.getSessionId\(\)\}\.json`\);/g,
		'panelsFile = join(dir(ctx.cwd, "artifacts"), `${ctx.sessionManager.getSessionId()}.json`);',
	);
	s = s.replaceAll('join(ctx.cwd, ".drawdream-cache"', 'join(dir(ctx.cwd, "cache")');
	s = s.replaceAll('join(appCwd, ".drawdream-media")', 'dir(appCwd, "media")');
	s = s.replaceAll(".drawdream-skills/", `${"${DIRS.skills}"}/`);
	// fix botched template - do cleanly
	s = s.replaceAll(".drawdream-skills/", ".drawdream-skills/");
	s = s.replaceAll(".rp-lore/", ".drawdream-lore/");
	s = s.replaceAll(".drawdream-codex/", ".drawdream-codex/");
	s = s.replaceAll(".drawdream-state", ".drawdream-state");
	s = s.replaceAll(".drawdream-artifacts", ".drawdream-artifacts");
	s = s.replaceAll(".drawdream-cache", ".drawdream-cache");
	s = s.replaceAll(".drawdream-media", ".drawdream-media");
	s = s.replaceAll(".drawdream-audio", ".drawdream-audio");
	s = s.replaceAll(".drawdream-uploads", ".drawdream-uploads");
	return s;
});

patch("server/main.ts", (s) => {
	s = s.replace(
		'const artifactsDir = join(cwd, ".drawdream-artifacts");',
		'const artifactsDir = dir(cwd, "artifacts");',
	);
	s = s.replaceAll('join(cwd, ".drawdream-media")', 'dir(cwd, "media")');
	s = s.replaceAll('join(cwd, ".drawdream-audio")', 'dir(cwd, "audio")');
	s = s.replaceAll('join(cwd, ".drawdream-uploads")', 'dir(cwd, "uploads")');
	return s;
});
