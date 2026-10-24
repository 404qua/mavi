export let KeysPressed = { up: 0, down: 0, right: 0, left: 0 }

function updateKeysPressed(event, value) {
	switch (event.key.toLowerCase()) {
		case 'arrowup':
		case 'w':
			KeysPressed.up = value;
			break;
		case 'arrowdown':
		case 's':
			KeysPressed.down = value;
			break;
		case 'arrowleft':
		case 'a':
			KeysPressed.left = value;
			break;
		case 'arrowright':
		case 'd':
			KeysPressed.right = value;
			break;
	}
}


const checkKeypressStarted = (event) => {
	updateKeysPressed(event, 1)
}

const checkKeypressEnded = (event) => {
	updateKeysPressed(event, 0)
}

export function StartInputChecking() {
	KeysPressed = { up: 0, down: 0, right: 0, left: 0 }
	window.addEventListener('keydown', checkKeypressStarted);
	window.addEventListener('keyup', checkKeypressEnded);
}

export function StopInputChecking() {
	KeysPressed = { up: 0, down: 0, right: 0, left: 0 }
	window.removeEventListener('keydown', checkKeypressStarted);
	window.removeEventListener('keyup', checkKeypressEnded);
}
