export type ExtensionCapability = "context.read" | "variables.read" | "variables.write" | "messages.send" | "messages.update" | "events.subscribe" | "card.ui";

export interface HeadlessExtension {
	id: string;
	capabilities: ExtensionCapability[];
	onLoad?: () => void | Promise<void>;
	onUnload?: () => void | Promise<void>;
}

export class HeadlessExtensionHost {
	private readonly extensions = new Map<string, HeadlessExtension>();

	async register(extension: HeadlessExtension, granted: ExtensionCapability[] = []): Promise<void> {
		if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(extension.id)) throw new Error("Invalid extension id");
		if (extension.capabilities.some((capability) => !granted.includes(capability))) throw new Error(`Extension capability denied: ${extension.id}`);
		if (this.extensions.has(extension.id)) throw new Error(`Extension already registered: ${extension.id}`);
		this.extensions.set(extension.id, { ...extension, capabilities: [...extension.capabilities] });
		try {
			await extension.onLoad?.();
		} catch (error) {
			this.extensions.delete(extension.id);
			throw error;
		}
	}

	async unregister(id: string): Promise<boolean> {
		const extension = this.extensions.get(id);
		if (!extension) return false;
		this.extensions.delete(id);
		await extension.onUnload?.();
		return true;
	}

	list(): HeadlessExtension[] {
		return [...this.extensions.values()].map((extension) => ({ ...extension, capabilities: [...extension.capabilities] }));
	}
}
