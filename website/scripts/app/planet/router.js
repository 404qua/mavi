import { ReplaceCurrentPath } from "./paths.js";
import {
	findPath as findPathInWorker,
	findPathDetailed as findPathDetailedInWorker,
	findRoute,
	snapCandidates as snapCandidatesInWorker,
} from "../../lib/pathfinder/pathfinder-client.js";

/**
 * Entry point for routing
 *
 * @param {{lat: number, lon: number}} start - {lat, lon} of origin
 * @param {{lat: number, lon: number}} end   - {lat, lon} of destination
 * @param {object} [opts]                   - search options (heuristicWeight, simplify, signal, onProgress, etc.)
 * @returns {Promise<object|null>}          - findPathDetailed result { coords, costCm, lengthCm, stats, ... } or null
 */
export async function route(start, end, opts = {}) {
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
		log?.("search progress", { ...progress, elapsedMs: +(now() - routeStart).toFixed(1) });
	};
	const { result, snapMs, startCandidates, endCandidates, ioProfile } = await findRoute(
		start,
		end,
		{ ...opts, onProgress },
		{
			onStage: ({ name, snapMs: elapsed, startCandidates: startCount, endCandidates: endCount }) => {
				if (name === "snapComplete") {
					log?.("snap complete", { ms: +elapsed.toFixed(1), startCandidates: startCount, endCandidates: endCount });
				}
			},
		},
	);

	if (!startCandidates || !endCandidates) {
		if (!startCandidates) globalThis.alert?.("starting location is dangerous");
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
}

export {
	ReplaceCurrentPath,
	snapCandidatesInWorker as snapCandidates,
	findPathInWorker as findPath,
	findPathDetailedInWorker as findPathDetailed,
};
