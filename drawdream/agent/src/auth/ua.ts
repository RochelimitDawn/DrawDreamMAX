/**
 * 轻量 User-Agent / 设备名解析。
 */

export type DeviceInfo = {
	deviceName: string;
	browser: string;
	os: string;
};

export function parseUserAgent(ua: string | undefined | null): DeviceInfo {
	const s = (ua || "").trim() || "unknown";
	const os = /Windows NT 10/i.test(s)
		? "Windows 10/11"
		: /Windows NT/i.test(s)
			? "Windows"
			: /Mac OS X/i.test(s)
				? "macOS"
				: /Android/i.test(s)
					? "Android"
					: /iPhone|iPad|iPod/i.test(s)
						? "iOS"
						: /Linux/i.test(s)
							? "Linux"
							: "未知系统";

	let browser = "浏览器";
	if (/Edg\//i.test(s)) browser = "Edge";
	else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
	else if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) browser = "Chrome";
	else if (/Firefox\//i.test(s)) browser = "Firefox";
	else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) browser = "Safari";
	else if (/MicroMessenger/i.test(s)) browser = "微信";

	const mobile = /Mobile|Android|iPhone|iPad/i.test(s);
	const kind = mobile ? "移动端" : "桌面";
	return {
		deviceName: `${kind} · ${os} · ${browser}`,
		browser,
		os,
	};
}
