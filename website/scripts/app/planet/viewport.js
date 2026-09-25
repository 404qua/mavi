import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

async function main() {

	const globeRadius = 3396190.0;
	const globeEllipsoid = new Cesium.Ellipsoid(globeRadius, globeRadius, globeRadius);

	Cesium.Ellipsoid.default = globeEllipsoid;

	const viewer = new Cesium.Viewer('viewport', {
		baseLayer: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		sceneModePicker: false,
		navigationHelpButton: false,
		animation: false,
		timeline: false,
		fullscreenButton: false,
		creditContainer: document.createElement('div'),
		globe: new Cesium.Globe(globeEllipsoid),

	})


	const scene = viewer.scene;

	scene.screenSpaceCameraController.maximumZoomDistance = globeRadius * 10;



	scene.skyAtmosphere = new Cesium.SkyAtmosphere(globeEllipsoid);
	scene.atmosphere = new Cesium.SkyAtmosphere(globeEllipsoid);

	scene.atmosphere.hueShift = 1;
	scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SUNLIGHT;

	scene.globe.showGroundAtmosphere = true;

	scene.skyAtmosphere.hueShift = 0.5;
	scene.skyAtmosphere.saturationShift = -0.2;
	scene.skyAtmosphere.brightnessShift = -0.4;

	scene.skyAtmosphere.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
		1.0e-6,
		4.0e-6,
		6.0e-6
	);

	scene.skyAtmosphere.atmosphereRayleighScaleHeight = 10000.0;
	scene.skyAtmosphere.atmosphereMieScaleHeight = 1000.0;
	const globe = viewer.scene.globe;
	globe.atmosphereHueShift = 0.5;
	globe.atmosphereSaturationShift = -0.2;
	globe.atmosphereBrightnessShift = -0.4;

	globe.baseColor = Cesium.Color.PERU;

	const imageryProvider = new Cesium.UrlTemplateImageryProvider({
		url: 'https://marswalk-assets.pages.dev/imagery/{z}/{x}/{y}.png',
		tilingScheme: new Cesium.GeographicTilingScheme({
			ellipsoid: globeEllipsoid
		}),
		minimumLevel: 0,
		maximumLevel: 3,
		credit: 'NASA'
	});

	viewer.imageryLayers.addImageryProvider(imageryProvider);
}

main()
