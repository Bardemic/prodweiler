import { Effect } from "effect";
import { AgentError } from "../../shared/contracts";
import {
	listCloudflareWorkers,
	listRecentWorkerErrors,
	listWorkerLatency,
} from "../cloudflare";
import { listMonitoredWorkers } from "../monitored-workers";

export type TimeWindow = {
	readonly from: number;
	readonly to: number;
};

export const agentTools: ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "list_cloudflare_workers",
			description: "List the Workers deployed in the Cloudflare account.",
			parameters: {
				type: "object",
				properties: {},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "list_monitored_workers",
			description: "List the Cloudflare Workers monitored by Prodweiler.",
			parameters: {
				type: "object",
				properties: {},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_recent_errors",
			description:
				"Get exceptions and error-level logs from this Worker for the current investigation window.",
			parameters: {
				type: "object",
				properties: {},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_recent_latency",
			description:
				"Get p50, p90, and p99 Worker wall-time telemetry by API route for the current investigation window.",
			parameters: {
				type: "object",
				properties: {},
				required: [],
			},
		},
	},
];

export const executeTool = (
	env: Cloudflare.Env,
	name: string,
	workerName: string,
	window: TimeWindow,
): Effect.Effect<unknown, AgentError> => {
	switch (name) {
		case "list_cloudflare_workers":
			return listCloudflareWorkers(env).pipe(
				Effect.mapError((error) =>
					new AgentError({ error: error.error }),
				),
			);
		case "list_monitored_workers":
			return listMonitoredWorkers(env.DB).pipe(
				Effect.mapError((error) =>
					new AgentError({ error: error.error }),
				),
			);
		case "get_recent_errors":
			return listRecentWorkerErrors(
				env,
				workerName,
				window.from,
				window.to,
			).pipe(
				Effect.mapError((error) =>
					new AgentError({ error: error.error }),
				),
			);
		case "get_recent_latency":
			return listWorkerLatency(
				env,
				workerName,
				window.from,
				window.to,
			).pipe(
				Effect.mapError((error) =>
					new AgentError({ error: error.error }),
				),
			);
		default:
			return Effect.fail(
				new AgentError({ error: `Unknown tool: ${name}` }),
			);
	}
};
