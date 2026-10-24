// written by copilot

let worker;
let nextRequestId = 0;
const pending = new Map();

function makeAbortError() {
	const error = new Error("aborted");
	error.name = "AbortError";
	return error;
}

function rejectPending(error) {
	for (const request of pending.values()) {
		request.signal?.removeEventListener("abort", request.abort);
		request.reject(error);
	}
	pending.clear();
}

function getWorker() {
	if (worker) return worker;

	const instance = new Worker(new URL("./pathfinder.worker.js", import.meta.url), {
		type: "module",
		name: "mars-pathfinder",
	});
	instance.addEventListener("message", ({ data }) => {
		const request = pending.get(data.id);
		if (!request) return;
		if (data.type === "progress") {
			try {
				request.onProgress?.(data.progress);
			} catch (error) {
				instance.postMessage({ type: "cancel", id: data.id });
				pending.delete(data.id);
				request.signal?.removeEventListener("abort", request.abort);
				request.reject(error);
			}
			return;
		}
		if (data.type === "stage") {
			try {
				request.onStage?.(data.stage);
			} catch (error) {
				instance.postMessage({ type: "cancel", id: data.id });
				pending.delete(data.id);
				request.signal?.removeEventListener("abort", request.abort);
				request.reject(error);
			}
			return;
		}

		pending.delete(data.id);
		request.signal?.removeEventListener("abort", request.abort);
		if (data.error) {
			const error = new Error(data.error.message);
			error.name = data.error.name;
			if (data.error.stack) error.stack = data.error.stack;
			request.reject(error);
		} else {
			request.resolve(data.result);
		}
	});

	const fail = (event) => {
		event.preventDefault?.();
		const error = event instanceof ErrorEvent && event.error
			? event.error
			: new Error(event.message || "Pathfinding worker failed");
		instance.terminate();
		if (worker === instance) worker = undefined;
		rejectPending(error);
	};
	instance.addEventListener("error", fail);
	instance.addEventListener("messageerror", () => {
		instance.terminate();
		if (worker === instance) worker = undefined;
		rejectPending(new Error("Could not read a pathfinding worker response"));
	});
	worker = instance;
	return instance;
}

function callWorker(method, args, { signal, onProgress, onStage } = {}) {
	if (signal?.aborted) return Promise.reject(makeAbortError());
	const id = ++nextRequestId;

	return new Promise((resolve, reject) => {
		let instance;
		let request;
		try {
			instance = getWorker();
			const abort = () => instance.postMessage({ type: "cancel", id });
			request = { resolve, reject, signal, abort, onProgress, onStage };
			pending.set(id, request);
			signal?.addEventListener("abort", abort, { once: true });
			instance.postMessage({ type: "request", id, method, args });
		} catch (error) {
			pending.delete(id);
			request?.signal?.removeEventListener("abort", request.abort);
			reject(error);
		}
	});
}

function splitOptions(options = {}) {
	const workerOptions = { ...options };
	const { signal, onProgress } = workerOptions;
	delete workerOptions.signal;
	delete workerOptions.onProgress;
	delete workerOptions.logProgress;
	return { signal, onProgress, workerOptions };
}

export function snapCandidates(lat, lon, options) {
	return callWorker("snapCandidates", [lat, lon, options]);
}

export function findPath(startNodes, endNodes, options = {}) {
	const { signal, onProgress, workerOptions } = splitOptions(options);
	return callWorker("findPath", [startNodes, endNodes, workerOptions], { signal, onProgress });
}

export function findPathDetailed(startNodes, endNodes, options = {}) {
	const { signal, onProgress, workerOptions } = splitOptions(options);
	return callWorker("findPathDetailed", [startNodes, endNodes, workerOptions], { signal, onProgress });
}

export function findRoute(start, end, options = {}, callbacks = {}) {
	const { signal, onProgress, workerOptions } = splitOptions(options);
	return callWorker("route", [start, end, workerOptions], {
		signal,
		onProgress,
		onStage: callbacks.onStage,
	});
}
