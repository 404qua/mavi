const inputElements = document.getElementsByClassName("monthInput");

const MonthNames = [
	"Early autumn",
	"Mid spring",
	"Late spring",
	"Early summer",
	"Mid summer",
	"Late summer",
	"Early autumn",
	"Mid autumn",
	"Late autumn",
	"Early winter",
	"Mid winter",
	"Late winter",
];

const ConditionNames = [
	"Typical",
	"Cold",
	"Warm",
	"Storm",
];

export function getCurrentWeatherSelections() {
	const monthSelect = document.querySelector('select[name="month"]');
	const timeSelect = document.querySelector('select[name="time"]');
	const conditionSelect = document.querySelector('select[name="condition"]');
	return {
		season: monthSelect ? Number(monthSelect.value) : 0,
		time: timeSelect ? timeSelect.value : 0,
		condition: conditionSelect ? Number(conditionSelect.value) : 0,
	};
}

for (const el of inputElements) {
	const minMonth = Number(el.dataset.minMonth ?? 1);
	const maxMonth = Number(el.dataset.maxMonth ?? 12);

	let monthOutput = "";
	for (let i = minMonth; i <= maxMonth; i++) {
		monthOutput += `<option value="${i - 1}" ${i == 1 ? "selected" : ""}>${MonthNames[i - 1]}</option> `;
	}

	let timeOutput = `<option value="mean">Daily Mean</option> `;
	for (let i = 0; i < 12; i++) {
		const hourVal = (i + 1) * 2;
		const hourStr = hourVal < 10 ? `0${hourVal}:00` : `${hourVal}:00`;
		timeOutput += `<option value="${i}" ${i == 0 ? "selected" : ""}>${hourStr}</option> `;
	}

	let conditionOutput = "";
	for (let i = 0; i < ConditionNames.length; i++) {
		conditionOutput += `<option value="${i}" ${i == 0 ? "selected" : ""}>${ConditionNames[i]}</option> `;
	}

	el.innerHTML = `
<span>
	<p>Season</p>
	<select name="month" id="${el.id}Season">
		${monthOutput}
	</select>
</span>

<span>
	<p>Time</p>
	<select name="time" id="${el.id}Time">
		${timeOutput}
	</select>
</span>

<span>
	<p>Condition</p>
	<select name="condition" id="${el.id}Condition">
		${conditionOutput}
	</select>
</span>

`;

	el.querySelectorAll("select").forEach((select) => {
		select.addEventListener("change", () => {
			document.dispatchEvent(
				new CustomEvent("weather-filter-change", {
					detail: getCurrentWeatherSelections(),
				})
			);
		});
	});
}
