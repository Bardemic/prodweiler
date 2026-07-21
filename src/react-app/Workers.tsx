import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
	CloudflareWorker,
	CloudflareWorkersResponse,
	MonitoredWorker,
	MonitoredWorkersResponse,
} from "../shared/contracts";

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
	const [selectedWorker, setSelectedWorker] = useState("");
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
			})
			.catch((cause: unknown) => setError(String(cause)))
			.finally(() => setLoading(false));
	}, []);

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
					body: JSON.stringify({ workerName: selectedWorker }),
				},
			);
			setMonitoredWorkers((workers) => [...workers, worker]);
			setSelectedWorker("");
		} catch (cause) {
			setError(String(cause));
		} finally {
			setAdding(false);
		}
	};

	return (
		<>
			<h2>Monitored workers</h2>

			<form onSubmit={addWorker}>
				<label htmlFor="worker">Cloudflare worker</label>
				<select
					id="worker"
					value={selectedWorker}
					onChange={(event) => setSelectedWorker(event.target.value)}
					disabled={loading || adding || availableWorkers.length === 0}
					required
				>
					<option value="">Select a worker</option>
					{availableWorkers.map(({ id }) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
				<button type="submit" disabled={adding || selectedWorker === ""}>
					{adding ? "Adding..." : "Add worker"}
				</button>
			</form>

			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}

			<div aria-live="polite">
				{loading ? (
					<p>Loading workers...</p>
				) : monitoredWorkers.length === 0 ? (
					<p>No monitored workers.</p>
				) : (
					<ul>
						{monitoredWorkers.map((worker) => (
							<li key={worker.id}>
								<strong>{worker.workerName}</strong>
								<span>
									Last checked: {" "}
									{worker.lastCheckedAt === null
										? "Not checked yet"
										: new Date(worker.lastCheckedAt).toLocaleString()}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}
