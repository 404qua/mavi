document.querySelectorAll(".uncheckable").forEach((e) => {
	let elementRequired = e.parentElement.tagName == "LABEL" ? e.parentElement : e;

	elementRequired.addEventListener("mousedown", () => {
		if (e.checked == true) {
			elementRequired.addEventListener("click", (event) => {
				event.preventDefault();
				e.checked = false
			}, { once: true })
		}
	})
})
