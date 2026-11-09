export function createWapointImage(svg) {
	return new Promise((resolve, reject) => {

		const canvasSize = 90;
		const padding = 8;
		const imageSize = canvasSize - (padding * 2) - 16;

		let canvas = document.createElement("canvas");
		canvas.width = canvasSize;
		canvas.height = canvasSize;

		let ctx = canvas.getContext("2d");

		let color = "#00000005"
		let outlineColor = "#ffffff08"
		let borderWidth = 2
		let borderRadius = 4

		ctx.beginPath();
		ctx.fillStyle = color;
		ctx.strokeStyle = outlineColor;
		let totalPadding = padding + (borderWidth / 2)
		ctx.roundRect(totalPadding, totalPadding, canvasSize - (totalPadding * 2), canvasSize - (totalPadding * 2), borderRadius)
		ctx.lineWidth = borderWidth;
		// ctx.stroke();
		ctx.fill();


		const svgLoader = new Image();

		svgLoader.onload = () => {
			let imagePosition = (canvasSize - imageSize) / 2
			ctx.drawImage(svgLoader, imagePosition, imagePosition, imageSize, imageSize);
			resolve(canvas.toDataURL("image/png"))
		}

		svgLoader.onerror = () => {
			reject(new Error(`Failed to load icon: ${svg}`));
		}

		svgLoader.src = svg;
	})
}
