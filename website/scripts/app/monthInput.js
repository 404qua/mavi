const inputElements = document.getElementsByClassName("monthInput");

const MonthNames = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

for (const el of inputElements) {
	const minYear = Number(el.dataset.minYear ?? 2000);
	const maxYear = Number(el.dataset.maxYear ?? 2026);
	const minMonth = Number(el.dataset.minMonth ?? 1);
	const maxMonth = Number(el.dataset.maxMonth ?? 12);

	let monthOutput = "";
	let yearOutput = "";

	for (let i = minMonth; i <= maxMonth; i++) {
		monthOutput += `<option value="${i}" ${i == maxMonth ? "selected" : ""}>${MonthNames[i - 1]}</option> `;
	}

	for (let i = minYear; i <= maxYear; i++) {
		yearOutput += `<option value="${i}" ${i == maxYear ? "selected" : ""}>${i}</option>`;
	}

	el.innerHTML = `
<select name="month" id="${el.id}Month">
	${monthOutput}
</select>

<select name="month" id="${el.id}Year">
	${yearOutput}
</select>
`;
}
