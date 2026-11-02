let joystick = document.getElementById("joystick");
let jostickThumb = document.getElementById("joystick__thumb");

let isDirty = true;

const resizeObserver = new ResizeObserver(() => {
	isDirty = true;
});
resizeObserver.observe(joystick);

let joystickBoundingBox;

export const JoystickOutput = {
	x: 0,
	y: 0,
	inputEnabled: false,
};

function startJoystick(event) {
	if (isDirty) {
		joystickBoundingBox = joystick.getBoundingClientRect();
	}

	JoystickOutput.inputEnabled = true;

	function updateJoyStick(e) {
		let mouseX = e.clientX;
		let mouseY = e.clientY;

		let joystickXPos =
			(mouseX - joystickBoundingBox.x) / joystickBoundingBox.width;
		let joystickYPos =
			(mouseY - joystickBoundingBox.y) / joystickBoundingBox.height;

		joystickXPos = (joystickXPos - 0.5) * 2;
		joystickYPos = (joystickYPos - 0.5) * 2;

		const distance = Math.max(
			Math.sqrt(joystickXPos ** 2 + joystickYPos ** 2),
			1,
		);

		let joystickXPosCircular = joystickXPos / distance;
		let joystickYPosCircular = joystickYPos / distance;

		JoystickOutput.x = joystickXPosCircular;
		JoystickOutput.y = joystickYPosCircular * -1;

		joystickYPosCircular = (joystickYPosCircular + 1) / 2;
		joystickXPosCircular = (joystickXPosCircular + 1) / 2;

		jostickThumb.style.setProperty(
			"--x-pos",
			(1 - joystickXPosCircular) * 100 + "%",
		);
		jostickThumb.style.setProperty(
			"--y-pos",
			joystickYPosCircular * 100 + "%",
		);
	}

	document.addEventListener("pointermove", updateJoyStick);

	updateJoyStick(event);

	function resetJoyStick() {
		document.removeEventListener("pointermove", updateJoyStick);
		JoystickOutput.inputEnabled = false;

		jostickThumb.style.setProperty("--x-pos", 50 + "%");
		jostickThumb.style.setProperty("--y-pos", 50 + "%");

		JoystickOutput.x = 0;
		JoystickOutput.y = 0;

		document.removeEventListener("pointerup", resetJoyStick);
	}

	document.addEventListener("pointerup", resetJoyStick);
}

joystick.addEventListener("pointerdown", startJoystick);

export function SetJoystickEnabled(enabled) {
	if (enabled == true) {
		joystick.classList.remove("disabled");
	} else {
		joystick.classList.add("disabled");
	}
}
