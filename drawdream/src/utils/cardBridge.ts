/**
 * 受控 HTML iframe 与父页的 postMessage 协议。
 */

export const CARD_BRIDGE_SOURCE = 'drawdream-card' as const
export const CARD_BRIDGE_MAX_TEXT = 8_000
export const CARD_BRIDGE_MIN_HEIGHT = 48
export const CARD_BRIDGE_MAX_HEIGHT = 2400
export const CARD_BRIDGE_PROTOCOL = 'drawdream-tavern-frame' as const
export const CARD_BRIDGE_VERSION = 1 as const

export type CardBridgeCapability =
  | 'context.read'
  | 'variables.read'
  | 'variables.write'
  | 'messages.send'
  | 'messages.update'
  | 'events.subscribe'
  | 'assets.read'
  | 'card.ui'
  | 'external.module'
  | 'slash.execute'

export type CardBridgeRequestType =
  | 'ready'
  | 'context.get'
  | 'variables.get'
  | 'variables.patch'
  | 'variables.schema'
  | 'message.send'
  | 'message.create'
  | 'message.snapshot'
  | 'message.update'
  | 'slash.execute'
  | 'event.subscribe'
  | 'asset.resolve'
  | 'dom.query'
  | 'dom.text'
  | 'dom.class'
  | 'module.authorize'
  | 'frame.resize'

export type CardBridgeRequest = {
  protocol: typeof CARD_BRIDGE_PROTOCOL
  version: typeof CARD_BRIDGE_VERSION
  frameId: string
  capabilityToken: string
  requestId: string
  type: CardBridgeRequestType
  payload?: unknown
}

export type CardBridgeResponse = {
  protocol: typeof CARD_BRIDGE_PROTOCOL
  version: typeof CARD_BRIDGE_VERSION
  frameId: string
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

export type CardBridgeSend = { type: 'send'; text: string }
export type CardBridgeResize = { type: 'resize'; height: number }
export type CardBridgeMessage = CardBridgeSend | CardBridgeResize

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

function pickText(record: Record<string, unknown>): string | null {
  for (const key of ['text', 'message', 'input', 'value'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, CARD_BRIDGE_MAX_TEXT)
  }
  return null
}

function isDrawDreamMessage(record: Record<string, unknown>): boolean {
  if (record.source === CARD_BRIDGE_SOURCE || record.from === CARD_BRIDGE_SOURCE) return true
  const type = String(record.type ?? record.action ?? record.cmd ?? '').trim().toLowerCase()
  if (/^drawdream[-_]/.test(type)) return true
  return record.ns === 'drawdream' || record.channel === 'card' || record.bridge === true
}

export function parseCardBridgeMessage(data: unknown): CardBridgeMessage | null {
  const record = asRecord(data)
  if (!record) return null
  const type = String(record.type ?? record.action ?? record.cmd ?? '').trim().toLowerCase().replace(/_/g, '-')
  const height = Number(record.height ?? record.h ?? record.value)
  if (type === 'resize' || type === 'height' || type === 'drawdream-resize') {
    if (!Number.isFinite(height) || height <= 0) return null
    return { type: 'resize', height: clampCardBridgeHeight(height) }
  }
  if (!type && Number.isFinite(height) && height > 0) {
    return { type: 'resize', height: clampCardBridgeHeight(height) }
  }
  if (!isDrawDreamMessage(record)) return null
  if (type === 'send' || type === 'prompt' || type === 'sendinput' || type === 'send-input' || type === 'drawdream-send' || type === 'drawdream-prompt') {
    const text = pickText(record)
    return text ? { type: 'send', text } : null
  }
  return null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseCardBridgeRequest(data: unknown): CardBridgeRequest | null {
  const record = asRecord(data)
  if (!record || record.protocol !== CARD_BRIDGE_PROTOCOL || record.version !== CARD_BRIDGE_VERSION) return null
  if (!isNonEmptyString(record.frameId) || !isNonEmptyString(record.capabilityToken) || !isNonEmptyString(record.requestId)) return null
  const allowed: CardBridgeRequestType[] = [
    'ready', 'context.get', 'variables.get', 'variables.patch', 'variables.schema', 'message.send',
    'message.update', 'message.create', 'message.snapshot', 'slash.execute', 'event.subscribe', 'asset.resolve', 'dom.query', 'dom.text', 'dom.class', 'frame.resize',
  ]
  if (typeof record.type !== 'string' || !allowed.includes(record.type as CardBridgeRequestType)) return null
  return {
    protocol: CARD_BRIDGE_PROTOCOL,
    version: CARD_BRIDGE_VERSION,
    frameId: record.frameId,
    capabilityToken: record.capabilityToken,
    requestId: record.requestId,
    type: record.type as CardBridgeRequestType,
    ...(Object.prototype.hasOwnProperty.call(record, 'payload') ? { payload: record.payload } : {}),
  }
}

export function createCardBridgeResponse(
  request: Pick<CardBridgeRequest, 'frameId' | 'requestId'>,
  result: { ok: true; value?: unknown } | { ok: false; error: string },
): CardBridgeResponse {
  return {
    protocol: CARD_BRIDGE_PROTOCOL,
    version: CARD_BRIDGE_VERSION,
    frameId: request.frameId,
    requestId: request.requestId,
    ...result,
  }
}

export function requiredCapabilityForRequest(type: CardBridgeRequestType): CardBridgeCapability | null {
  switch (type) {
    case 'context.get': return 'context.read'
    case 'variables.get': return 'variables.read'
    case 'variables.patch': return 'variables.write'
    case 'variables.schema': return 'variables.write'
    case 'message.send': return 'messages.send'
    case 'message.create': return 'messages.update'
    case 'message.update': return 'messages.update'
    case 'message.snapshot': return 'context.read'
    case 'slash.execute': return 'slash.execute'
    case 'event.subscribe': return 'events.subscribe'
    case 'asset.resolve': return 'assets.read'
    case 'dom.query':
    case 'dom.text':
    case 'dom.class': return 'card.ui'
    default: return null
  }
}

export function cardBridgeBootstrapScript(options: {
  frameId?: string
  capabilityToken?: string
  capabilities?: CardBridgeCapability[]
} = {}): string {
  const frameId = options.frameId ?? 'card-frame'
  const capabilityToken = options.capabilityToken ?? 'card-token'
  const capabilities = options.capabilities ?? []
  return `<script>(function(){try{
 var S=${JSON.stringify(CARD_BRIDGE_SOURCE)};
 var P=${JSON.stringify(CARD_BRIDGE_PROTOCOL)};
 var V=${CARD_BRIDGE_VERSION};
 var F=${JSON.stringify(frameId)};
 var T=${JSON.stringify(capabilityToken)};
 var C=${JSON.stringify(capabilities)};
 var seq=0;var pending={};var listeners={};
 function post(p){try{parent.postMessage(Object.assign({source:S,protocol:P,version:V,frameId:F,capabilityToken:T},p),'*')}catch(e){}}
 function request(type,payload){var requestId=F+'-'+(++seq);post({type:type,requestId:requestId,payload:payload});return new Promise(function(resolve,reject){pending[requestId]={resolve:resolve,reject:reject};});}
 window.addEventListener('message',function(event){var d=event.data||{};if(d.protocol===P&&d.version===V&&d.frameId===F&&d.requestId&&pending[d.requestId]){var p=pending[d.requestId];delete pending[d.requestId];d.ok?p.resolve(d.value):p.reject(new Error(d.error||'Tavern bridge request failed'));return;}if(d.protocol===P&&d.version===V&&d.frameId===F&&d.type==='event'){(listeners[d.event]||[]).forEach(function(fn){try{fn(d.payload,d)}catch(e){}});}});
 function on(event,fn){(listeners[event]||(listeners[event]=[])).push(fn);if(listeners[event].length===1){request('event.subscribe',{events:[event]}).catch(function(){});}return function(){listeners[event]=(listeners[event]||[]).filter(function(x){return x!==fn;});};}
 window.DrawDream=window.DrawDream||{};
 window.DrawDream.send=function(t){post({type:'send',text:String(t==null?'':t)});return request('message.send',{text:String(t==null?'':t)})};
 window.DrawDream.prompt=window.DrawDream.send;
 window.DrawDream.resize=function(h){post({type:'resize',height:Number(h)||0});return request('frame.resize',{height:Number(h)||0})};
 window.TavernFrame={capabilities:C,request:request,on:on};
 window.TavernFrame.getContext=function(){return request('context.get')};
 window.TavernFrame.getVariables=function(scope){return request('variables.get',{scope:scope||'chat'})};
  window.TavernFrame.patchVariables=function(transaction){return request('variables.patch',transaction)};
  window.TavernFrame.setVariableSchema=function(schema){return request('variables.schema',{schema:schema||null})};
  window.TavernFrame.resolveAsset=function(path){return request('asset.resolve',{path:String(path||'')})};
  window.TavernFrame.authorizeModule=function(url,declared,granted){return request('module.authorize',{url:String(url||''),declared:Array.isArray(declared)?declared:[],granted:Array.isArray(granted)?granted:[]})};
  window.TavernFrame.dom={query:function(selector){return request('dom.query',{selector:String(selector||'')})},text:function(selector,value){return request('dom.text',{selector:String(selector||''),value:value==null?undefined:String(value)})},className:function(selector,value){return request('dom.class',{selector:String(selector||''),value:String(value||'')})}};
 var ctx=function(){return window.TavernFrame.getContext();};
 window.SillyTavern=window.SillyTavern||{};
 window.SillyTavern.getContext=ctx;
 window.SillyTavern.substituteParams=function(text){return String(text==null?'':text).replace(/\\{\\{\\s*(char|user)\\s*\\}\\}/gi,function(_,name){var c=window.SillyTavern.__context||{};return name.toLowerCase()==='char'?(c.name2||''):(c.name1||'');});};
 window.SillyTavern.eventSource={on:on,addListener:on,once:function(event,fn){var off=on(event,function(payload,meta){off();fn(payload,meta);});return off;},removeListener:function(event,fn){(listeners[event]||[]).forEach(function(x){if(x===fn)listeners[event]=listeners[event].filter(function(y){return y!==x;});});},emit:function(){return Promise.resolve(false);}};
 window.SillyTavern.event_types={APP_READY:'app_ready',CHAT_CHANGED:'chat_changed',MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',VARIABLES_UPDATED:'variables_updated',GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended'};
 window.TavernHelper=window.TavernHelper||{};
 window.TavernHelper.getVariables=function(o){return window.TavernFrame.getVariables((o&&o.scope)||'chat');};
 window.TavernHelper.updateVariables=function(p,o){var ops=p&&p.operations?p.operations:[{op:'merge',path:'variables',value:p||{}}];return window.TavernFrame.patchVariables({transactionId:F+'-mvu-'+(++seq),sessionId:(window.SillyTavern.__context||{}).chatId||'',baseRevision:(o&&o.revision)||0,scope:(o&&o.scope)||'chat',messageId:o&&o.messageId,operations:ops});};
  window.TavernHelper.replaceVariables=window.TavernHelper.updateVariables;
  window.TavernHelper.registerVariableSchema=window.TavernFrame.setVariableSchema;
 window.TavernHelper.triggerSlash=function(command){return request('slash.execute',{command:String(command||'')});};
  window.TavernHelper.getChatMessages=function(){return request('message.snapshot').then(function(v){return v.messages||[];});};
 window.TavernHelper.createChatMessages=function(messages){return request('message.create',{messages:Array.isArray(messages)?messages:[]});};
 window.TavernHelper.setChatMessages=function(messages){return request('message.update',{messages:Array.isArray(messages)?messages:[]});};
 window.TavernHelper.deleteChatMessages=function(ids){return request('message.update',{deleteIds:Array.isArray(ids)?ids:[]});};
 window.TavernHelper.getCurrentMessageId=function(){var c=window.SillyTavern.__context||{};return c.chat&&c.chat.length?c.chat[c.chat.length-1].id:null;};
 window.TavernFrame.getContext().then(function(c){window.SillyTavern.__context=c;});
 post({type:'ready',requestId:F+'-ready'});
 }catch(e){}})();</` + `script>`
}

export function clampCardBridgeHeight(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return CARD_BRIDGE_MIN_HEIGHT
  return Math.min(CARD_BRIDGE_MAX_HEIGHT, Math.max(CARD_BRIDGE_MIN_HEIGHT, Math.round(height)))
}
