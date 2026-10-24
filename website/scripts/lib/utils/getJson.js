export async function getJson(url) {
	let i = 1
	while (true) {
		try {
			let response = await fetch(url);
			if (!response.ok) {
				throw new Error(response.status);
			}

			const json = await response.json();

			return json;
		} catch (error) {
			console.error(error);
			await new Promise((resolve) =>
				setTimeout(resolve, 200 * Math.pow(2, i)),
			);

			i++
		}
	}
}
