import { ReplaceCurrentPath, ClearCurrentPath } from "./paths.js";
import {
	findPath as findPathInWorker,
	findPathDetailed as findPathDetailedInWorker,
	findRoute,
	snapCandidates as snapCandidatesInWorker,
} from "../../lib/pathfinder/pathfinder-client.js";

let activeRouteController = null;

export function cancelFinder() {
	if (activeRouteController) {
		activeRouteController.abort();
		activeRouteController = null;
		return true;
	}
	return false;
}

export async function route(start, end, opts = {}) {
	cancelFinder();
	const controller = new AbortController();
	activeRouteController = controller;
	if (opts.signal) {
		opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
	}

	const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
	const routeStart = now();
	const log = typeof opts.logProgress === "function"
		? opts.logProgress
		: opts.logProgress
			? (label, details) => console.info(`[route] ${label}`, details)
			: null;
	const userOnProgress = opts.onProgress;
	const onProgress = (progress) => {
		userOnProgress?.(progress);
		opts.updateUI?.(progress.statusText, progress.progress);
		log?.("search progress", { ...progress, elapsedMs: +(now() - routeStart).toFixed(1) });
	};

	try {
		const { result, snapMs, startCandidates, endCandidates, ioProfile } = await findRoute(
			start,
			end,
			{ ...opts, signal: controller.signal, onProgress },
			{
				onStage: (stage) => {
					opts.onStage?.(stage);
					if (stage.name === "snapComplete") {
						log?.("snap complete", { ms: +stage.snapMs.toFixed(1), startCandidates: stage.startCandidates, endCandidates: stage.endCandidates });
					}
				},
			},
		);

		if (!startCandidates || !endCandidates) {
			if (!opts.silent && !startCandidates) globalThis.alert?.("starting location is dangerous");
			log?.("route unavailable", { totalMs: +(now() - routeStart).toFixed(1) });
			return null;
		}

		const drawStart = now();
		if (result && result.coords && result.coords.length >= 4) {
			ReplaceCurrentPath(result.coords);
		}

		const drawMs = now() - drawStart;
		if (result?.stats) {
			result.stats.profile ??= {};
			result.stats.profile.io = ioProfile;
			result.stats.profile.drawMs = drawMs;
		}

		log?.("route complete", {
			totalMs: +(now() - routeStart).toFixed(1),
			snapMs: +snapMs.toFixed(1),
			drawMs: +drawMs.toFixed(1),
			source: result?.source ?? null,
			profile: result?.stats?.profile ?? { io: ioProfile },
			...(result?.stats ?? {}),
		});

		return result;
	} finally {
		if (activeRouteController === controller) {
			activeRouteController = null;
		}
	}
}

export {
	ReplaceCurrentPath,
	ClearCurrentPath,
	snapCandidatesInWorker as snapCandidates,
	findPathInWorker as findPath,
	findPathDetailedInWorker as findPathDetailed,
};
