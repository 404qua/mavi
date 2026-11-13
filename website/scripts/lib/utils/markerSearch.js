import { getJson } from "./getJson";

const features = await getJson("data/mars_features.json");

export function searchMarsFeatures(query, x, minScore = 0) {
	const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase();
	const resultCount = Math.max(0, Math.floor(Number(x) || 0));

	if (!normalizedQuery || resultCount === 0) return [];

	return features
		.map((feature, index) => {
			const name = String(feature.name ?? "").toLocaleLowerCase();
			const otherText = [feature.type, feature.description, feature.origin]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase();

			let score = 0;
			if (name === normalizedQuery) score = 3;
			else if (name.startsWith(normalizedQuery)) score = 2;
			else if (name.includes(normalizedQuery)) score = 1;
			else if (otherText.includes(normalizedQuery)) score = 0.4;

			score += (feature.importance/3)*0.3

			if (score < minScore) {
				return {};
			}

			return { index, score };
		})
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, resultCount)
		.map(({ index }) => index);
}
