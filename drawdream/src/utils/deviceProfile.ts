/**
 * 设备性能档位检测：Android 原生壳通过 JSBridge 返回内存/核心数，
 * 低端机据此降级动画与重渲染，保证交互流畅。
 */

let cachedTier: "low" | "mid" | "high" | "unknown" | null = null

export type DeviceTier = "low" | "mid" | "high" | "unknown"

function fromBridge(): DeviceTier {
	try {
		const win = window as unknown as {
			DrawDreamAndroid?: { deviceProfile?: () => string }
		}
		const raw = win.DrawDreamAndroid?.deviceProfile?.()
		if (!raw) return "unknown"
		const parsed = JSON.parse(raw) as { tier?: DeviceTier; ramMb?: number; cores?: number }
		return parsed.tier ?? "unknown"
	} catch {
		return "unknown"
	}
}

function fromNavigator(): DeviceTier {
	try {
		// navigator.deviceMemory（Chrome）与 hardwareConcurrency 估算
		const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory
		const cores = navigator.hardwareConcurrency || 4
		if (typeof mem === "number" && mem > 0) {
			if (mem < 4 || cores < 4) return "low"
			if (mem < 8 || cores < 6) return "mid"
			return "high"
		}
		if (cores < 4) return "low"
		if (cores < 6) return "mid"
		return "high"
	} catch {
		return "unknown"
	}
}

export function getDeviceTier(): DeviceTier {
	if (cachedTier) return cachedTier
	const bridged = fromBridge()
	cachedTier = bridged !== "unknown" ? bridged : fromNavigator()
	return cachedTier
}

/** 低端机（或系统开启 reduced-motion）：应关闭动画/简化渲染。 */
export function shouldReduceMotion(): boolean {
	if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
		return true
	}
	const tier = getDeviceTier()
	return tier === "low"
}

/** 中低端机：简化（非禁用）动画。 */
export function shouldSimplifyMotion(): boolean {
	const tier = getDeviceTier()
	return tier === "low" || tier === "mid"
}
