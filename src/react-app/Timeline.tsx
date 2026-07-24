import { useState } from "react";
import type { MonitoringCheck } from "../shared/contracts";
import styles from "./Timeline.module.css";

const BUCKET_MS = 10 * 60 * 1_000;
const BUCKETS_PER_DAY = 144;
const MAX_DAY_OFFSET = 2;

type TimelineProps = {
	readonly checks: ReadonlyArray<MonitoringCheck>;
};

type Tooltip = {
	readonly text: string;
	readonly left: number;
	readonly width: number;
	readonly arrowLeft: number;
};

const describeCheck = (check?: MonitoringCheck) => {
	if (check === undefined) {
		return "Not checked";
	}

	return {
		healthy: "No errors",
		errors: "Errors",
		anomaly: "Anomaly detected",
		investigated: "AI investigated",
	}[check.status];
};

export function Timeline({ checks }: TimelineProps) {
	const [dayOffset, setDayOffset] = useState(0);
	const [tooltip, setTooltip] = useState<Tooltip | null>(null);
	const [currentBucket] = useState(() => Math.floor(Date.now() / BUCKET_MS));
	const endBucket = currentBucket - dayOffset * BUCKETS_PER_DAY;
	const startBucket = endBucket - BUCKETS_PER_DAY + 1;
	const checksByBucket = new Map(
		checks.map((check) => [
			Math.floor(new Date(check.to).getTime() / BUCKET_MS),
			check,
		]),
	);
	const buckets = Array.from({ length: BUCKETS_PER_DAY }, (_, index) => {
		const bucket = startBucket + index;
		return { bucket, check: checksByBucket.get(bucket) };
	});
	const labels = [0, 36, 72, 108].map((index) =>
		new Date((startBucket + index) * BUCKET_MS).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		}),
	);
	const dateLabel = new Date(startBucket * BUCKET_MS).toLocaleDateString([], {
		month: "short",
		day: "numeric",
	});
	const showTooltip = (tick: HTMLButtonElement, text: string) => {
		const track = tick.parentElement as HTMLDivElement;
		const width = Math.min(260, track.clientWidth - 16);
		const tickCenter = tick.offsetLeft + tick.offsetWidth / 2;
		const left = Math.max(
			8,
			Math.min(tickCenter - width / 2, track.clientWidth - width - 8),
		);

		setTooltip({
			text,
			left,
			width,
			arrowLeft: tickCenter - left,
		});
	};

	return (
		<section
			className={styles.panel}
			aria-label="24-hour monitoring timeline"
		>
			<div className={styles.heading}>
				<span>{dateLabel}</span>
				<div className={styles.navigation}>
					<button
						type="button"
						aria-label="Previous day"
						onClick={() => {
							setDayOffset((offset) => offset + 1);
							setTooltip(null);
						}}
						disabled={dayOffset === MAX_DAY_OFFSET}
					>
						←
					</button>
					<button
						type="button"
						aria-label="Next day"
						onClick={() => {
							setDayOffset((offset) => offset - 1);
							setTooltip(null);
						}}
						disabled={dayOffset === 0}
					>
						→
					</button>
				</div>
			</div>

			<div
				className={styles.track}
				aria-label={`${checks.length} completed checks`}
				onMouseLeave={() => setTooltip(null)}
			>
				{buckets.map(({ bucket, check }) => {
					const description = describeCheck(check);
					const status = check?.status ?? "pending";

					return (
						<button
							type="button"
							key={bucket}
							className={`${styles.tick} ${styles[status]}`}
							aria-label={description}
							onMouseEnter={(event) =>
								showTooltip(event.currentTarget, description)
							}
							onFocus={(event) =>
								showTooltip(event.currentTarget, description)
							}
							onBlur={() => setTooltip(null)}
						/>
					);
				})}
				{tooltip !== null && (
					<div
						className={styles.tooltip}
						role="tooltip"
						style={{ left: tooltip.left, width: tooltip.width }}
					>
						<span
							className={styles.tooltipArrow}
							style={{ left: tooltip.arrowLeft }}
						/>
						{tooltip.text}
					</div>
				)}
			</div>
			<div className={styles.labels}>
				{labels.map((label) => (
					<span key={label}>{label}</span>
				))}
			</div>
		</section>
	);
}
