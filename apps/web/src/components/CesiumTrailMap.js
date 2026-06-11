import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
export default function CesiumTrailMap({ trail, ionToken }) {
    const containerRef = useRef(null);
    const viewerRef = useRef(null);
    // Initialise viewer once
    useEffect(() => {
        if (!containerRef.current)
            return;
        const token = import.meta.env['VITE_CESIUM_ION_TOKEN'] ??
            ionToken ??
            '';
        Cesium.Ion.defaultAccessToken = token;
        // OSM imagery via UrlTemplateImageryProvider (works in all Cesium 1.x versions)
        const osmLayer = new Cesium.UrlTemplateImageryProvider({
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            credit: new Cesium.Credit('© OpenStreetMap contributors', false),
            maximumLevel: 19,
        });
        const viewer = new Cesium.Viewer(containerRef.current, {
            baseLayer: new Cesium.ImageryLayer(osmLayer),
            terrainProvider: new Cesium.EllipsoidTerrainProvider(),
            animation: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false,
            navigationInstructionsInitiallyVisible: false,
            creditContainer: document.createElement('div'),
        });
        viewer.scene.globe.enableLighting = false;
        if (viewer.scene.skyAtmosphere) {
            viewer.scene.skyAtmosphere.show = true;
        }
        viewerRef.current = viewer;
        return () => {
            if (!viewer.isDestroyed())
                viewer.destroy();
            viewerRef.current = null;
        };
    }, [ionToken]);
    // Re-draw entities whenever trail changes
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer || viewer.isDestroyed())
            return;
        viewer.entities.removeAll();
        if (trail.length === 0)
            return;
        const positions = trail.map(p => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0));
        // Full trail — glowing orange polyline
        viewer.entities.add({
            polyline: {
                positions,
                width: 3,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.15,
                    color: Cesium.Color.fromCssColorString('#ff9040'),
                }),
                clampToGround: true,
            },
        });
        const firstPos = positions[0];
        const lastPos = positions[positions.length - 1];
        // Start marker — green dot
        if (firstPos) {
            viewer.entities.add({
                position: firstPos,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.LIME,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
            });
        }
        // Current-position marker — pulsing orange dot
        if (lastPos) {
            const startTime = viewer.clock.startTime;
            const clock = viewer.clock;
            viewer.entities.add({
                position: lastPos,
                point: {
                    pixelSize: new Cesium.CallbackProperty(() => {
                        const t = Cesium.JulianDate.secondsDifference(clock.currentTime, startTime);
                        return 10 + 4 * Math.abs(Math.sin(t * 1.8));
                    }, false),
                    color: Cesium.Color.fromCssColorString('#ff9040'),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
            });
        }
        viewer.clock.shouldAnimate = true;
        void viewer.flyTo(viewer.entities, {
            duration: 1.8,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 0),
        });
    }, [trail]);
    return (<div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }}/>);
}
