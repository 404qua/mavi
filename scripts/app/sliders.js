document.querySelectorAll(".slider").forEach((e) => {
	const input = e.querySelector("input")

	function syncSlider() {
		const min = Number(input.min) || 0;
		const max = Number(input.max) || 100;

		const value = ((input.value - min)/(max-min))*100;

		e.style.setProperty("--value",value+"%")
	}

	input.addEventListener("input", syncSlider);
	syncSlider();
})
