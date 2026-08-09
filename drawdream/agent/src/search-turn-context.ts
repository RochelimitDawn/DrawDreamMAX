export type SearchTurnPolicy = "off" | "force";

const policies = new Map<string, SearchTurnPolicy>();

function key(cwd: string, sessionId: string): string {
	return `${cwd}\0${sessionId}`;
}

export function setSearchTurnPolicy(cwd: string, sessionId: string, policy: SearchTurnPolicy): void {
	policies.set(key(cwd, sessionId), policy);
}

export function getSearchTurnPolicy(cwd: string, sessionId: string): SearchTurnPolicy {
	return policies.get(key(cwd, sessionId)) ?? "off";
}
