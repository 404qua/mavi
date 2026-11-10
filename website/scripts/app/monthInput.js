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

for (const el of inputElements) {
	const minMonth = Number(el.dataset.minMonth ?? 1);
	const maxMonth = Number(el.dataset.maxMonth ?? 12);

	let monthOutput = "";

	for (let i = minMonth; i <= maxMonth; i++) {
		monthOutput += `<option value="${i - 1}" ${i == maxMonth ? "selected" : ""}>${MonthNames[i - 1]}</option> `;
	}

	let timeOutput = "";
	for (let i = 0; i <= 24; i += 2) {
		timeOutput += `<option value="${i}" ${i == 0 ? "selected" : ""}>${i}:00</option> `;
	}

	let conditionOutput = "";
	for (let i = 0; i < ConditionNames.length; i++) {
		conditionOutput += `<option value="${i}" ${i == 0 ? "selected" : ""}>${ConditionNames[i]}</option> `;
	}

	// const minYear = Number(el.dataset.minYear ?? 2000);
	// const maxYear = Number(el.dataset.maxYear ?? 2026);
	// let yearOutput = "";
	// for (let i = minYear; i <= maxYear; i++) {
	// 	yearOutput += `<option value="${i}" ${i == maxYear ? "selected" : ""}>${i}</option>`;
	// }

	el.innerHTML = `
<span>
	<p>Season </p>
		<select name="month" id="${el.id}Month">
			${monthOutput}
		</select>
</span>

<span>
	<p>Time </p>
		<select name="time" id="${el.id}Month">
			${timeOutput}
		</select>
</span>

<span>
	<p>Condition </p>
		<select name="condition" id="${el.id}Month">
			${conditionOutput}
		</select>
</span>
`;


	// <!-- <select name="month" id="${el.id}Year"> -->
	// <!-- 	${yearOutput} -->
	// <!-- </select> -->
}
