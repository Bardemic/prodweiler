import { Effect } from "effect";
import { AgentError } from "../../shared/contracts";
import { agentTools, executeTool, type TimeWindow } from "./tools";

const MODEL = "@cf/zai-org/glm-4.7-flash" as const;
const MAX_STEPS = 6;

export const systemMessage = (workerName: string) => ({
	role: "system" as const,
	content: `You are Prodweiler, the production watchdog for ${workerName}. You are investigating one specific production issue. Use tools before making claims about current infrastructure state. Inspect the relevant error and latency telemetry, stay scoped to the issue in the conversation, and distinguish evidence from inference.`,
});

export const runAgent = (
	env: Cloudflare.Env,
	messages: ChatCompletionMessageParam[],
	workerName: string,
	window: TimeWindow,
	step: number,
): Effect.Effect<string, AgentError> =>
	Effect.gen(function* () {
		if (step >= MAX_STEPS) {
			return yield* Effect.fail(
				new AgentError({ error: "Agent exceeded its tool step limit" }),
			);
		}

		const result = yield* Effect.tryPromise({
			try: () =>
				env.AI.run(MODEL, {
					messages,
					tools: agentTools,
					tool_choice: "auto",
				}),
			catch: (error) => new AgentError({ error: String(error) }),
		});

		const choice = result.choices[0];
		if (choice === undefined) {
			return yield* Effect.fail(
				new AgentError({ error: "The model returned no response" }),
			);
		}

		const toolCalls = choice.message.tool_calls;
		yield* Effect.logInfo("agent.step.completed").pipe(
			Effect.annotateLogs({
				step,
				finishReason: choice.finish_reason,
				toolCalls: toolCalls === undefined ? 0 : toolCalls.length,
				hasContent: choice.message.content !== null,
			}),
		);
		if (toolCalls === undefined || toolCalls.length === 0) {
			if (choice.message.content === null) {
				return yield* Effect.fail(
					new AgentError({ error: "The model returned no content" }),
				);
			}
			return choice.message.content;
		}

		messages.push({
			role: "assistant",
			content: choice.message.content,
			tool_calls: toolCalls,
		});
		for (const toolCall of toolCalls) {
			if (toolCall.type !== "function") {
				return yield* Effect.fail(
					new AgentError({
						error: "The model requested an unsupported tool",
					}),
				);
			}
			const toolResult = yield* executeTool(
				env,
				toolCall.function.name,
				workerName,
				window,
			);
			messages.push({
				role: "tool",
				tool_call_id: toolCall.id,
				content: JSON.stringify(toolResult),
			});
		}

		return yield* runAgent(env, messages, workerName, window, step + 1);
	});
