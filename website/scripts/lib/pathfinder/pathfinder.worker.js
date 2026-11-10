// written by copilot

import { getDiagnostics, snapCandidates } from "./snapper.js";
import { diagnosticsDelta } from "./utils.js";
import { findPath, findPathDetailed } from "./search.js";

const requests = new Map();

function serializeError(error) {
	return {
		name: error?.name ?? "Error",
		message: error?.message ?? String(error),
		stack: error?.stack,
	};
}

async function runRoute([start, end, options], signal, id) {
	const diagnosticsBefore = getDiagnostics();
	const started = performance.now();
	const startLat = start.lat ?? start.latitude;
	const startLon = start.lon ?? start.longitude;
	const endLat = end.lat ?? end.latitude;
	const endLon = end.lon ?? end.longitude;

	self.postMessage({
		type: "progress",
		id,
		progress: {
			phase: "snap",
			progress: 5,
			statusText: "Snapping positions to terrain",
			areaSearchedKm2: 0,
		},
	});

	const [starts, ends] = await Promise.all([
		snapCandidates(startLat, startLon, { direction: "from", count: options.snapCount ?? 8 }),
		snapCandidates(endLat, endLon, { direction: "to", count: options.snapCount ?? 8 }),
	]);
	const snapMs = performance.now() - started;
	self.postMessage({
		type: "stage",
		id,
		stage: { name: "snapComplete", snapMs, startCandidates: starts?.length ?? 0, endCandidates: ends?.length ?? 0 },
	});

	let result = null;
	if (starts?.length && ends?.length) {
		result = await findPathDetailed(starts, ends, {
			...options,
			signal,
			onProgress: (progress) => self.postMessage({ type: "progress", id, progress }),
		});
	}

	return {
		result,
		snapMs,
		startCandidates: starts?.length ?? 0,
		endCandidates: ends?.length ?? 0,
		ioProfile: diagnosticsDelta(diagnosticsBefore, getDiagnostics()),
	};
}

async function dispatch(method, args, controller, id) {
	const [startNodes, endNodes, options] = args;
	const onProgress = (progress) => self.postMessage({ type: "progress", id, progress });

	switch (method) {
		case "snapCandidates":
			return snapCandidates(...args);
		case "findPath":
			return findPath(startNodes, endNodes, { ...options, signal: controller.signal, onProgress });
		case "findPathDetailed":
			return findPathDetailed(startNodes, endNodes, { ...options, signal: controller.signal, onProgress });
		case "route":
			return runRoute(args, controller.signal, id);
		default:
			throw new Error(`Unknown pathfinding operation: ${method}`);
	}
}

self.addEventListener("message", async ({ data }) => {
	if (data.type === "cancel") {
		requests.get(data.id)?.abort();
		return;
	}
	if (data.type !== "request") return;

	const controller = new AbortController();
	requests.set(data.id, controller);
	try {
		const result = await dispatch(data.method, data.args, controller, data.id);
		self.postMessage({ type: "result", id: data.id, result });
	} catch (error) {
		self.postMessage({ type: "result", id: data.id, error: serializeError(error) });
	} finally {
		requests.delete(data.id);
	}
});
