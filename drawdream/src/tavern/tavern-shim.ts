/**
 * 卡内脚本运行时垫片（参考梨园 Liyuan tavernShim.ts，clean-room 实现）。
 *
 * 为卡脚本提供最小 SillyTavern 兼容调用面：
 * - window.TavernHelper.generate / stopAllGeneration
 * - triggerSlash（`/send 文本|/trigger` 管道）
 * - eventOn / eventEmit（iframe 内与父页各一份事件总线）
 * - 通过 parent.TavernHelper 或 postMessage 与父页通信
 *
 * 安全边界：不提供「写正文」通道；卡脚本只能在 iframe 内操作自己的 DOM。
 */

import { sessionStore } from '../agent/session-store'
import { tavernRuntime } from './runtime-adapter'

export type TavernGenerateParams = {
	user_input?: string
	should_stream?: boolean
	disable_extras?: boolean
	[k: string]: unknown
}

/** 父页注册：把卡侧 slash / generate 接到输入框与 WS prompt */
export type TavernChatBridge = {
	/** 只填输入框，不发送 */
	setInput: (text: string) => void
	/** 作为用户消息发送并触发生成（空串 = 发送当前输入框内容） */
	sendPrompt: (text: string) => void
	/** 可选：执行 DrawDream 斜杠命令原文（如 /reroll） */
	runCommand?: (text: string) => void
}

type BusMap = Map<string, Set<(...args: unknown[]) => void>>

let chatBridge: TavernChatBridge | null = null

export function registerTavernChatBridge(bridge: TavernChatBridge | null): void {
	chatBridge = bridge
}

export function getTavernChatBridge(): TavernChatBridge | null {
	return chatBridge
}

function getBus(target: object): BusMap {
	const w = target as { __drawdreamEventBus?: BusMap }
	if (!w.__drawdreamEventBus) w.__drawdreamEventBus = new Map()
	return w.__drawdreamEventBus
}

/** 挂 eventOn / eventEmit（iframe 内与父页各一份即可） */
export function installEventBus(target: object = typeof window !== "undefined" ? window : {}): void {
	const t = target as {
		eventOn?: (name: string, cb: (...args: unknown[]) => void) => void
		eventEmit?: (name: string, ...args: unknown[]) => void
	}
	if (typeof t.eventOn === "function" && typeof t.eventEmit === "function") return

	const bus = getBus(target)
	t.eventOn = (name, cb) => {
		if (!bus.has(name)) bus.set(name, new Set())
		bus.get(name)!.add(cb)
	}
	t.eventEmit = (name, ...args) => {
		const set = bus.get(name)
		if (!set) return
		for (const cb of set) {
			try {
				cb(...args)
			} catch (e) {
				console.error("[drawdream eventEmit]", name, e)
			}
		}
	}
}

/** 解析酒馆式管道斜杠：`/send 文本|/trigger`，分段以 `|` 分隔 */
export function parseSlashPipeline(raw: string): string[] {
	return String(raw ?? "")
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean)
}

export type SlashExecResult = {
	ok: boolean
	text?: string
	triggered?: boolean
	filledOnly?: boolean
	error?: string
}

/** 执行 triggerSlash 命令串：/send、/trigger，以及二者管道组合 */
export function executeTriggerSlash(raw: string, bridge: TavernChatBridge | null): SlashExecResult {
	if (!bridge) {
		return { ok: false, error: "聊天桥未就绪" }
	}
	const parts = parseSlashPipeline(raw)
	if (!parts.length) return { ok: false, error: "空命令" }

	let pendingSend = ""
	let wantTrigger = false
	let filledOnly = false

	for (const part of parts) {
		const cmd = part.startsWith("/") ? part : `/${part}`
		const mSend = cmd.match(/^\/send(?:as)?(?:\s+name=[^\s]+)?\s*([\s\S]*)$/i)
		if (mSend) {
			pendingSend = (mSend[1] ?? "").trim()
			continue
		}
		if (/^\/trigger\b/i.test(cmd)) {
			wantTrigger = true
			continue
		}
		if (cmd.startsWith("/") && bridge.runCommand) {
			try {
				bridge.runCommand(cmd)
			} catch (e) {
				console.warn("[drawdream triggerSlash] runCommand", cmd, e)
			}
			continue
		}
		console.warn("[drawdream triggerSlash] 未识别命令", cmd)
	}

	if (wantTrigger) {
		const text = pendingSend
		try {
			bridge.sendPrompt(text)
			return { ok: true, text, triggered: true }
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	if (pendingSend) {
		try {
			bridge.setInput(pendingSend)
			filledOnly = true
			return { ok: true, text: pendingSend, filledOnly }
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	return { ok: true }
}

/** 父页全局 triggerSlash（iframe 通过 parent 或 postMessage 调用） */
export async function triggerSlash(raw: string): Promise<string> {
	const r = executeTriggerSlash(raw, chatBridge)
	if (!r.ok) {
		console.warn("[drawdream triggerSlash]", r.error, raw?.slice?.(0, 80))
		return r.error || ""
	}
	return r.text || ""
}

/**
 * 父页安装：卡脚本通过 window.parent.TavernHelper / triggerSlash 访问。
 * 默认 bridge 接 DrawDream sessionStore（sendPrompt → prompt，runCommand → command）。
 */
export function installParentTavernShim(): void {
	if (typeof window === "undefined") return
	const w = window as Window & {
		__drawdreamTavernShimInstalled?: boolean
		eventOn?: (name: string, cb: (...args: unknown[]) => void) => void
		eventEmit?: (name: string, ...args: unknown[]) => void
		TavernHelper?: {
			generate: (params?: TavernGenerateParams) => Promise<string>
			stopAllGeneration: () => void
		}
		triggerSlash?: (cmd: string) => Promise<string> | string
	}
	if (w.__drawdreamTavernShimInstalled) return
	w.__drawdreamTavernShimInstalled = true

	// 默认桥：接 DrawDream 会话
	if (!chatBridge) {
		chatBridge = {
			setInput: () => { /* 无输入框引用，跳过 */ },
			sendPrompt: (text) => { void sessionStore.prompt(text) },
			runCommand: (text) => { sessionStore.command(text) },
		}
	}

	installEventBus(w)
	w.triggerSlash = (cmd: string) => triggerSlash(cmd)

	if (typeof window.addEventListener === "function") {
		window.addEventListener("message", (ev: MessageEvent) => {
			const d = ev.data as { drawdreamTriggerSlash?: unknown } | null
			if (!d || typeof d.drawdreamTriggerSlash !== "string") return
			void triggerSlash(d.drawdreamTriggerSlash)
		})
	}

	w.TavernHelper = {
		async generate(params) {
			const input = String(params?.user_input ?? "").trim()
			if (chatBridge && input) {
				try {
					chatBridge.sendPrompt(input)
					return input
				} catch (e) {
					console.warn("[drawdream TavernHelper.generate]", e)
				}
			}
			console.warn("[drawdream TavernHelper.generate] 无 bridge 或空输入", {
				len: input.length,
				stream: params?.should_stream,
			})
			return `（DrawDream：界面内 AI 生成未接入聊天桥。输入：${input.slice(0, 80) || "（空）"}）`
		},
		stopAllGeneration() {
			sessionStore.abort()
		},
	}

	// 将 tavernRuntime 的 Tavern 事件转发到父页事件总线，
	// iframe 内 eventOn(name, cb) 订阅后即可收到（如 message_received）。
	// 仅在未安装过转发器时安装一次，避免重复订阅。
	const w2 = w as Window & { __drawdreamTavernEventBridge?: boolean }
	if (!w2.__drawdreamTavernEventBridge) {
		w2.__drawdreamTavernEventBridge = true
		const EVENT_TYPES = [
			'app_ready', 'chat_changed', 'character_selected', 'message_sent',
			'message_received', 'message_updated', 'message_swiped',
			'generation_started', 'generation_ended', 'variables_updated',
			'chat_metadata_updated',
		] as const
		for (const type of EVENT_TYPES) {
			tavernRuntime.events.on(type, (event) => {
				try {
					installEventBus(w)
					w.eventEmit?.(type, event.payload, event)
				} catch (e) {
					console.error("[drawdream tavern-event]", type, e)
				}
			})
		}
	}
}

/**
 * 注入到脚本帧 head 最前：同源下挂 TavernHelper + triggerSlash；
 * 并尽量镜像 parent（双保险）；跨域则 postMessage。
 */
export const IFRAME_TAVERN_BRIDGE_SNIPPET = `<script>(function(){
try{
  var g=typeof window!=="undefined"?window:null;if(!g)return;
  function bus(){if(!g.__drawdreamEventBus)g.__drawdreamEventBus=new Map();return g.__drawdreamEventBus;}
  function parentWin(){try{return g.parent&&g.parent!==g?g.parent:null;}catch(e){return null;}}
  function parentTH(){var p=parentWin();return p&&p.TavernHelper?p.TavernHelper:null;}
  if(typeof g.eventOn!=="function"){
    g.eventOn=function(name,cb){
      var b=bus();if(!b.has(name))b.set(name,new Set());b.get(name).add(cb);
      // 同时向父页订阅：父页把 tavernRuntime 事件转发到其总线，触发本监听
      try{var p=parentWin();if(p&&typeof p.eventOn==="function")p.eventOn(name,function(){var args=[].slice.call(arguments);cb.apply(null,args);});}catch(e){}
      return function(){if(b.has(name))b.get(name).delete(cb);};
    };
  }
  if(typeof g.eventEmit!=="function"){
    g.eventEmit=function(name){var args=[].slice.call(arguments,1),b=bus(),s=b.get(name);if(!s)return;
      s.forEach(function(cb){try{cb.apply(null,args);}catch(e){console.error(e);}});};
  }
  if(typeof g.triggerSlash!=="function"){
    g.triggerSlash=function(cmd){
      var p=parentWin();
      try{
        if(p&&typeof p.triggerSlash==="function"){
          var r=p.triggerSlash(cmd);
          return r&&typeof r.then==="function"?r:Promise.resolve(r);
        }
      }catch(e){}
      try{if(p)p.postMessage({drawdreamTriggerSlash:String(cmd||"")},"*");}catch(e2){}
      return Promise.resolve("");
    };
  }
  if(!g.TavernHelper){
    g.TavernHelper={
      generate:function(params){
        var p=parentTH();
        if(p&&typeof p.generate==="function")return p.generate(params);
        console.warn("[drawdream iframe] TavernHelper.generate stub");
        var u=(params&&params.user_input)||"";
        return Promise.resolve("（DrawDream：界面内 AI 生成尚未接入）"+String(u).slice(0,80));
      },
      stopAllGeneration:function(){
        var p=parentTH();
        if(p&&typeof p.stopAllGeneration==="function")return p.stopAllGeneration();
      }
    };
  }
}catch(e){console.error("[drawdream bridge]",e);}
})();</script>`;
