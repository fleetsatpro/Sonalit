import * as d3 from 'd3';
export const CONTINENT_VIEWS = {
    global: { center: [0, 20], scale: 140 },
    africa: { center: [20, 0], scale: 360 },
    asia: { center: [90, 35], scale: 280 },
    europe: { center: [15, 54], scale: 500 },
    americas: { center: [-80, 15], scale: 260 },
    oceania: { center: [140, -25], scale: 380 },
    mideast: { center: [45, 28], scale: 600 },
};
export function flyTo(svg, zoom, projection, center, scale, W, H) {
    const k = scale / 140;
    const projected = projection(center);
    if (!projected)
        return;
    const [cx, cy] = projected;
    const tx = W / 2 - k * cx;
    const ty = H / 2 - k * cy;
    svg.transition().duration(750).ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
}
