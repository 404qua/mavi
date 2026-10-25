const roverDataCache = new Map();

async function fetchRoverData(rover) {
    if (!["perseverance", "curiosity"].includes(rover)) {
        throw new Error(`Unknown rover: ${rover}`);
    }

    if (!roverDataCache.has(rover)) {
        const request = fetch(
            `https://azmth.space/data/mars-traverses/${rover}.json`
        )
            .then(response => {
                if (!response.ok) {
                    throw new Error(
                        `Rover data request failed: ${response.status}`
                    );
                }

                return response.json();
            })
            .catch(error => {
                roverDataCache.delete(rover);
                throw error;
            });

        roverDataCache.set(rover, request);
    }

    return roverDataCache.get(rover);
}