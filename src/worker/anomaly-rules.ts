import type { RouteLatency } from "../shared/contracts";

const MINIMUM_BASELINE_WINDOWS = 6;
const MEDIAN_ABSOLUTE_DEVIATIONS = 6;

type ErrorRateAnomalyContext = {
	readonly errorCount: number;
	readonly errorRate: number;
	readonly previousErrorRates: ReadonlyArray<number>;
};

type LatencyPercentile = "p50" | "p90" | "p99";

const minimumSamples: Record<LatencyPercentile, number> = {
	p50: 2,
	p90: 10,
	p99: 100,
};

export type LatencyAnomalyContext = {
	readonly current: RouteLatency;
	readonly previous: ReadonlyArray<RouteLatency>;
};

type AnomalyRule<Context> = {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly matches: (context: Context) => boolean;
};

const median = (values: ReadonlyArray<number>) => {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
};

const isAdaptiveIncrease = (
	current: number,
	previous: ReadonlyArray<number>,
	multiplier: number,
) => {
	if (previous.length < MINIMUM_BASELINE_WINDOWS) {
		return false;
	}

	const baseline = median(previous);
	const deviation = median(previous.map((value) => Math.abs(value - baseline)));
	const exceedsRelativeChange =
		baseline === 0 ? current > 0 : current >= baseline * multiplier;
	const exceedsNormalVariation =
		deviation === 0
			? current > baseline
			: current > baseline + MEDIAN_ABSOLUTE_DEVIATIONS * deviation;

	return exceedsRelativeChange && exceedsNormalVariation;
};

const latencyRule = (
	percentile: LatencyPercentile,
): AnomalyRule<LatencyAnomalyContext> => ({
	id: `latency-${percentile}`,
	name: `${percentile} latency regression`,
	description: `${percentile} has enough requests to resolve that percentile, is at least 2x its route's rolling median, and is more than 6 median absolute deviations above normal`,
	matches: ({ current, previous }) =>
		current.sampleCount >= minimumSamples[percentile] &&
		isAdaptiveIncrease(
			current[percentile],
			previous
				.filter(
					({ sampleCount }) => sampleCount >= minimumSamples[percentile],
				)
				.map((window) => window[percentile]),
			2,
		),
});

export const errorAnomalyRules: ReadonlyArray<
	AnomalyRule<ErrorRateAnomalyContext>
> = [
	{
		id: "error-rate-spike",
		name: "Error rate spike",
		description:
			"At least 3 matching errors whose per-request rate is at least 3x its rolling median and more than 6 median absolute deviations above normal",
		matches: ({ errorCount, errorRate, previousErrorRates }) =>
			errorCount >= 3 &&
			isAdaptiveIncrease(errorRate, previousErrorRates, 3),
	},
];

export const latencyAnomalyRules: ReadonlyArray<
	AnomalyRule<LatencyAnomalyContext>
> = [latencyRule("p50"), latencyRule("p90"), latencyRule("p99")];

export const detectErrorAnomalies = (context: ErrorRateAnomalyContext) =>
	errorAnomalyRules.filter((rule) => rule.matches(context));

export const detectLatencyAnomalies = (context: LatencyAnomalyContext) =>
	latencyAnomalyRules.filter((rule) => rule.matches(context));

export const latencyBaseline = (
	previous: ReadonlyArray<RouteLatency>,
): RouteLatency | undefined => {
	if (previous.length < MINIMUM_BASELINE_WINDOWS) {
		return undefined;
	}

	return {
		route: previous[0].route,
		sampleCount: median(previous.map(({ sampleCount }) => sampleCount)),
		p50: median(previous.map(({ p50 }) => p50)),
		p90: median(previous.map(({ p90 }) => p90)),
		p99: median(previous.map(({ p99 }) => p99)),
	};
};

export const anomalyRuleInfo = [
	...errorAnomalyRules,
	...latencyAnomalyRules,
].map(({ id, name, description }) => ({ id, name, description }));
