import assert from "node:assert/strict";
import test from "node:test";
import {
	CARD_BRIDGE_SOURCE,
	CARD_BRIDGE_PROTOCOL,
	CARD_BRIDGE_VERSION,
	createCardBridgeResponse,
	parseCardBridgeRequest,
	requiredCapabilityForRequest,
	parseCardBridgeMessage,
	clampCardBridgeHeight,
	cardBridgeBootstrapScript,
	cardFrameViewportStyle,
} from "../../src/utils/cardBridge.ts";

test("parse send canonical", () => {
	const m = parseCardBridgeMessage({
		source: CARD_BRIDGE_SOURCE,
		v: 1,
		type: "send",
		text: "  你好  ",
	});
	assert.deepEqual(m, { type: "send", text: "你好" });
});

test("parse send aliases", () => {
	assert.equal(
		parseCardBridgeMessage({ source: CARD_BRIDGE_SOURCE, action: "prompt", message: "走" })?.type,
		"send",
	);
	assert.equal(
		parseCardBridgeMessage({ ns: "drawdream", type: "sendInput", input: "A" })?.text,
		"A",
	);
	assert.equal(
		parseCardBridgeMessage({ type: "drawdream-send", text: "x" })?.text,
		"x",
	);
});

test("reject unknown / empty", () => {
	assert.equal(parseCardBridgeMessage(null), null);
	assert.equal(parseCardBridgeMessage("hi"), null);
	assert.equal(parseCardBridgeMessage({ type: "send", text: "x" }), null); // 无来源标记
	assert.equal(parseCardBridgeMessage({ source: CARD_BRIDGE_SOURCE, type: "send", text: "  " }), null);
	assert.equal(parseCardBridgeMessage({ source: CARD_BRIDGE_SOURCE, type: "eval", text: "1" }), null);
});

test("parse resize + clamp", () => {
	assert.deepEqual(
		parseCardBridgeMessage({ source: CARD_BRIDGE_SOURCE, type: "resize", height: 120 }),
		{ type: "resize", height: 120 },
	);
	assert.equal(clampCardBridgeHeight(10), 48);
	assert.equal(clampCardBridgeHeight(99999), 2400);
});

test("beautify page height postMessage", () => {
	assert.deepEqual(parseCardBridgeMessage({ source: "war-homepage", height: 520 }), {
		type: "resize",
		height: 520,
	});
	assert.deepEqual(parseCardBridgeMessage({ height: 300 }), { type: "resize", height: 300 });
});

test("bootstrap exposes DrawDream", () => {
	const s = cardBridgeBootstrapScript();
	assert.ok(s.includes("DrawDream"));
	assert.ok(s.includes(CARD_BRIDGE_SOURCE));
	assert.ok(s.includes("postMessage"));
	assert.ok(s.includes("window.SillyTavern"));
	assert.ok(s.includes("window.TavernHelper"));
	assert.ok(s.includes("eventSource"));
	assert.ok(s.includes("pending"));
	assert.ok(s.includes("new Promise"));
	assert.ok(s.includes("createChatMessages"));
	assert.ok(s.includes("setChatMessages"));
	assert.ok(s.includes("deleteChatMessages"));
});

test("parse Tavern frame request and map capability", () => {
	const request = parseCardBridgeRequest({
		protocol: CARD_BRIDGE_PROTOCOL,
		version: CARD_BRIDGE_VERSION,
		frameId: "frame-1",
		capabilityToken: "token-1",
		requestId: "request-1",
		type: "variables.patch",
		payload: { scope: "chat" },
	});
	assert.equal(request?.type, "variables.patch");
	assert.equal(requiredCapabilityForRequest("variables.patch"), "variables.write");
	assert.equal(requiredCapabilityForRequest("frame.resize"), null);
});

test("reject malformed Tavern frame requests and build responses", () => {
	assert.equal(parseCardBridgeRequest({ protocol: CARD_BRIDGE_PROTOCOL, version: CARD_BRIDGE_VERSION }), null);
	assert.equal(parseCardBridgeRequest({
		protocol: CARD_BRIDGE_PROTOCOL,
		version: CARD_BRIDGE_VERSION,
		frameId: "frame-1",
		capabilityToken: "token-1",
		requestId: "request-1",
		type: "eval",
	}), null);
	assert.deepEqual(createCardBridgeResponse(
		{ frameId: "frame-1", requestId: "request-1" },
		{ ok: false, error: "denied" },
	), {
		protocol: CARD_BRIDGE_PROTOCOL,
		version: CARD_BRIDGE_VERSION,
		frameId: "frame-1",
		requestId: "request-1",
		ok: false,
		error: "denied",
	});
});

test("controlled DOM and asset requests require explicit capabilities", () => {

	assert.equal(requiredCapabilityForRequest("dom.query"), "card.ui");
	assert.equal(requiredCapabilityForRequest("asset.resolve"), "assets.read");
	const script = cardBridgeBootstrapScript({ capabilities: ["card.ui", "assets.read"] });
	assert.ok(script.includes("resolveAsset"));
	assert.ok(script.includes("TavernFrame.dom"));
});

test("card iframe viewport style enables safe-area and touch behavior", () => {
	assert.deepEqual(cardFrameViewportStyle({ safeArea: true, touchEvents: true }), {
		touchAction: "manipulation",
		paddingBottom: "env(safe-area-inset-bottom)",
	});
	assert.deepEqual(cardFrameViewportStyle(), {});
});
