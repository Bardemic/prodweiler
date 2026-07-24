import { useState } from "react";
import type { MonitoringIssue } from "../shared/contracts";
import styles from "./InvestigationThread.module.css";

type InvestigationThreadProps = {
	readonly issues: ReadonlyArray<MonitoringIssue>;
};

export function InvestigationThread({ issues }: InvestigationThreadProps) {
	const [selectedIssueId, setSelectedIssueId] = useState("");
	const selectedIssue =
		issues.find(({ id }) => id === selectedIssueId) ?? issues[0];
	const investigations =
		selectedIssue?.messages.filter(({ role }) => role === "assistant") ?? [];

	return (
		<section className={styles.panel}>
			<div className={styles.heading}>
				<h2>Agent investigation</h2>
				<select
					aria-label="Issue thread"
					value={selectedIssue?.id ?? ""}
					onChange={(event) => setSelectedIssueId(event.target.value)}
					disabled={issues.length === 0}
				>
					{issues.length === 0 ? (
						<option value="">No issues</option>
					) : (
						issues.map((issue) => (
							<option key={issue.id} value={issue.id}>
								{issue.title} ({issue.status})
							</option>
						))
					)}
				</select>
			</div>

			<div className={styles.investigations} aria-live="polite">
				{investigations.length === 0 ? (
					<p>No investigation yet.</p>
				) : (
					investigations.map((message) => (
						<article className={styles.investigation} key={message.id}>
							<strong>
								{new Date(message.createdAt).toLocaleString()}
							</strong>
							<p>{message.content}</p>
						</article>
					))
				)}
			</div>
		</section>
	);
}
