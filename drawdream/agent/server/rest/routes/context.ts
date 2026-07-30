/**
 * REST 路由共享上下文。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RestHost } from "../types.ts";

export type RouteCtx = {
	req: IncomingMessage;
	res: ServerResponse;
	host: RestHost;
	query: URLSearchParams;
	route: string;
	/** 流式中拒绝写操作；返回 true 表示已响应 */
	refuseWhileStreaming: () => boolean;
};
