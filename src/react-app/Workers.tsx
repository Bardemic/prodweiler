import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
	CloudflareWorker,
	CloudflareWorkersResponse,
	MonitoredWorker,
	MonitoredWorkersResponse,
	MonitoringState,
} from "../shared/contracts";
import { InvestigationThread } from "./InvestigationThread";
import { Timeline } from "./Timeline";
import styles from "./Workers.module.css";

const request = async <ResponseBody,>(
	url: string,
	init?: RequestInit,
): Promise<ResponseBody> => {
	const response = await fetch(url, init);

	if (!response.ok) {
		throw new Error(`Request failed (${response.status})`);
	}

	return response.json() as Promise<ResponseBody>;
};

export function Workers() {
	const [cloudflareWorkers, setCloudflareWorkers] = useState<
		ReadonlyArray<CloudflareWorker>
	>([]);
	const [monitoredWorkers, setMonitoredWorkers] = useState<
		ReadonlyArray<MonitoredWorker>
	>([]);
	const [workerToAdd, setWorkerToAdd] = useState("");
	const [selectedWorker, setSelectedWorker] = useState("");
	const [monitoringState, setMonitoringState] =
		useState<MonitoringState | null>(null);
	const [loading, setLoading] = useState(true);
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([
			request<CloudflareWorkersResponse>("/api/cloudflare/workers"),
			request<MonitoredWorkersResponse>("/api/monitored-workers"),
		])
			.then(([cloudflareWorkers, monitoredWorkers]) => {
				setCloudflareWorkers(cloudflareWorkers);
				setMonitoredWorkers(monitoredWorkers);
				setSelectedWorker(monitoredWorkers[0]?.workerName ?? "");
			})
			.catch((cause: unknown) => setError(String(cause)))
			.finally(() => setLoading(false));
	}, []);

	const loadMonitoringState = async (workerName: string) => {
		const state = await request<MonitoringState>(
			`/api/monitoring?workerName=${encodeURIComponent(workerName)}`,
		);
		setMonitoringState(state);
	};

	useEffect(() => {
		if (selectedWorker === "") {
			setMonitoringState(null);
			return;
		}

		setMonitoringState(null);
		loadMonitoringState(selectedWorker).catch((cause: unknown) =>
			setError(String(cause)),
		);
	}, [selectedWorker]);

	const monitoredNames = new Set(
		monitoredWorkers.map(({ workerName }) => workerName),
	);
	const availableWorkers = cloudflareWorkers.filter(
		({ id }) => !monitoredNames.has(id),
	);

	const addWorker = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setAdding(true);
		setError(null);

		try {
			const worker = await request<MonitoredWorker>(
				"/api/monitored-workers",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ workerName: workerToAdd }),
				},
			);
			setMonitoredWorkers((workers) => [...workers, worker]);
			setWorkerToAdd("");
			setSelectedWorker(worker.workerName);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setAdding(false);
		}
	};

	return (
		<div className={styles.shell}>
			<aside className={styles.sidebar}>
				<h1>Prodweiler</h1>

				<div className={styles.sidebarControls}>
					<label className={styles.workerPicker}>
						<span>Worker</span>
						<select
							value={selectedWorker}
							onChange={(event) =>
								setSelectedWorker(event.target.value)
							}
							disabled={loading || monitoredWorkers.length === 0}
						>
							{monitoredWorkers.map(({ workerName }) => (
								<option key={workerName} value={workerName}>
									{workerName}
								</option>
							))}
						</select>
					</label>

					<form className={styles.addWorker} onSubmit={addWorker}>
						<label htmlFor="worker-to-add">Add monitored worker</label>
						<select
							id="worker-to-add"
							value={workerToAdd}
							onChange={(event) =>
								setWorkerToAdd(event.target.value)
							}
							disabled={
								loading ||
								adding ||
								availableWorkers.length === 0
							}
							required
						>
							<option value="">Select a Cloudflare Worker</option>
							{availableWorkers.map(({ id }) => (
								<option key={id} value={id}>
									{id}
								</option>
							))}
						</select>
						<button
							type="submit"
							disabled={adding || workerToAdd === ""}
						>
							{adding ? "Adding..." : "Add"}
						</button>
					</form>
				</div>
			</aside>

			<main className={styles.main}>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}

				{selectedWorker !== "" && (
					<div className={styles.dashboard}>
						<div className={styles.timelineCard}>
							<Timeline checks={monitoringState?.checks ?? []} />
						</div>
						<div className={styles.dashboardPanels}>
							<InvestigationThread
								issues={monitoringState?.issues ?? []}
							/>
							<section
								className={styles.monitoringContent}
								aria-label="Monitoring details"
							/>
						</div>
					</div>
				)}
			</main>
		</div>
	);
}
