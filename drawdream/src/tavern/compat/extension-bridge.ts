import type { CardBridgeCapability } from '../../utils/cardBridge.ts'
import type { ExtensionRuntimeRequestType } from './extension-runtime.ts'

export const EXTENSION_BRIDGE_PROTOCOL = 'drawdream-extension-frame' as const

export type ExtensionBridgeRequest = {
  protocol: typeof EXTENSION_BRIDGE_PROTOCOL
  frameId: string
  token: string
  requestId: string
  type: ExtensionRuntimeRequestType
  payload?: unknown
}

export function extensionBridgeBootstrap(options: {
  frameId: string
  token: string
  capabilities: CardBridgeCapability[]
}): string {
  const frame = JSON.stringify(options.frameId)
  const token = JSON.stringify(options.token)
  const capabilities = JSON.stringify(options.capabilities)
  return `<script>(function(){
var P=${JSON.stringify(EXTENSION_BRIDGE_PROTOCOL)},F=${frame},T=${token},C=${capabilities},N=0,Q={},L={};
function request(type,payload){var id=F+'-'+(++N);parent.postMessage({protocol:P,frameId:F,token:T,requestId:id,type:type,payload:payload},'*');return new Promise(function(resolve,reject){Q[id]={resolve:resolve,reject:reject};});}
window.addEventListener('message',function(e){var d=e.data||{};if(d.protocol!==P||d.frameId!==F)return;if(d.type==='event'){(L[d.event]||[]).forEach(function(fn){try{fn(d.payload,d)}catch(err){}});return;}if(!d.requestId||!Q[d.requestId])return;var q=Q[d.requestId];delete Q[d.requestId];d.ok?q.resolve(d.value):q.reject(new Error(d.error||'DrawDream extension request failed'));});
function on(event,fn){(L[event]||(L[event]=[])).push(fn);request('event.subscribe',{events:[event]}).catch(function(){});return function(){L[event]=(L[event]||[]).filter(function(x){return x!==fn;});};}
window.SillyTavern=window.SillyTavern||{};
window.SillyTavern.getContext=function(){return request('context.get');};
window.SillyTavern.eventSource={on:on,addListener:on,once:function(event,fn){var off=on(event,function(payload,meta){off();fn(payload,meta);});return off;},emit:function(){return Promise.resolve(false);}};
window.SillyTavern.event_types={APP_READY:'app_ready',CHAT_CHANGED:'chat_changed',MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',VARIABLES_UPDATED:'variables_updated',GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended'};
window.TavernHelper=window.TavernHelper||{};
window.TavernHelper.getVariables=function(o){return request('variables.get',o||{});};
window.TavernHelper.updateVariables=function(v,o){var ops=v&&v.operations?v.operations:[{op:'merge',path:'variables',value:v||{}}];return request('variables.patch',{transactionId:F+'-mvu-'+(++N),sessionId:(window.SillyTavern.__context||{}).chatId||'',baseRevision:(o&&o.revision)||0,scope:(o&&o.scope)||'chat',messageId:o&&o.messageId,operations:ops});};
window.TavernHelper.replaceVariables=window.TavernHelper.updateVariables;
window.TavernHelper.registerVariableSchema=function(schema){return request('variables.schema',{schema:schema||null});};
window.TavernHelper.getChatMessages=function(){return request('message.snapshot').then(function(v){return v&&v.messages||[];});};
window.TavernHelper.createChatMessages=function(messages){return request('message.create',{messages:Array.isArray(messages)?messages:[]});};
window.TavernHelper.setChatMessages=function(messages){return request('message.update',{messages:Array.isArray(messages)?messages:[]});};
window.TavernHelper.deleteChatMessages=function(ids){return request('message.update',{deleteIds:Array.isArray(ids)?ids:[]});};
window.TavernHelper.triggerSlash=function(command){return request('slash.execute',{command:String(command||'')});};
window.TavernHelper.generate=function(text,opts){return request('generate',Object.assign({text:String(text||'')},opts||{}));};
window.TavernHelper.getWorldBooks=function(){return request('worldbook.list');};
window.TavernHelper.getWorldBook=function(path){return request('worldbook.get',{path:path});};
window.TavernHelper.selectWorldBooks=function(paths){return request('worldbook.select',{paths:paths});};
window.TavernHelper.putWorldBookEntry=function(entry){return request('worldbook.entry.put',entry||{});};
window.TavernHelper.getPresets=function(){return request('preset.list');};
window.TavernHelper.getActivePreset=function(){return request('preset.get');};
window.TavernHelper.selectPreset=function(file){return request('preset.select',{file:file});};
window.TavernHelper.getCharacter=function(){return request('character.get');};
window.TavernHelper.injectPrompt=function(text,opts){return request('inject.prompt',Object.assign({text:String(text||'')},opts||{}));};
window.TavernHelper.speak=function(text,opts){return request('audio.speak',Object.assign({text:String(text||'')},opts||{}));};
window.DrawDreamExtension={capabilities:C,request:request,on:on,resize:function(h){return request('parent.resize',{height:Number(h)||0});},fetch:function(url,opts){return request('http.fetch',{url:String(url||''),options:opts||{}});}};
window.DrawDream=window.DrawDream||{};window.DrawDream.resize=window.DrawDreamExtension.resize;window.DrawDream.fetch=window.DrawDreamExtension.fetch;
request('context.get').then(function(c){window.SillyTavern.__context=c;}).catch(function(){});
request('ready',{capabilities:C}).catch(function(){});
}())</script>`
}
