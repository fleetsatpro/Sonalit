import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { CONTINENT_VIEWS, flyTo } from '../utils/map.js'
import { levelColor } from '../utils/colors.js'
import MapPopup from './MapPopup.js'
import type { RiskZone, Continent } from '../types/risk.js'

interface Props {
  zones: RiskZone[]
  activeCont: Continent
  activeZoneId: string | null
  heatVisible: boolean
  onZoneClick: (id: string) => void
}

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

export default function RiskMap({ zones, activeCont, activeZoneId, heatVisible, onZoneClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const projRef = useRef<d3.GeoProjection | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [popup, setPopup] = useState<{ zone: RiskZone; x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)

  // Build the map once on mount
  useEffect(() => {
    const container = containerRef.current
    const svgEl = svgRef.current
    if (!container || !svgEl) return

    const W = container.clientWidth || 800
    const H = container.clientHeight || 440

    const svg = d3.select(svgEl)
      .attr('width', W).attr('height', H)
      .style('background', '#0a1424')

    // Projection
    const proj = d3.geoNaturalEarth1()
      .scale(140)
      .translate([W / 2, H / 2])
    projRef.current = proj
    const path = d3.geoPath().projection(proj)

    // Layers
    const gMap      = svg.append('g').attr('class', 'g-map')
    const gHeat     = svg.append('g').attr('class', 'g-heat')
    const gHotspots = svg.append('g').attr('class', 'g-hotspots')

    // Graticule
    gMap.append('path')
      .datum(d3.geoGraticule()())
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,.04)')
      .attr('stroke-width', 0.5)

    // Sphere outline
    gMap.append('path')
      .datum({ type: 'Sphere' } as d3.GeoPermissibleObjects)
      .attr('d', path as unknown as string)
      .attr('fill', '#0a1424')
      .attr('stroke', 'rgba(255,255,255,.06)')
      .attr('stroke-width', 1)

    // Countries
    d3.json<Topology>(WORLD_URL)
      .then(world => {
        if (!world) return
        const countries = topojson.feature(world, world.objects['countries'] as GeometryCollection)
        gMap.selectAll<SVGPathElement, GeoJSON.Feature>('.country')
          .data((countries as GeoJSON.FeatureCollection).features)
          .join('path')
          .attr('class', 'country')
          .attr('d', path)
          .attr('fill', '#0f2040')
          .attr('stroke', 'rgba(255,255,255,.08)')
          .attr('stroke-width', 0.4)
      })
      .catch(() => {
        gMap.append('rect')
          .attr('width', W).attr('height', H)
          .attr('fill', '#0f2040')
      })

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 15])
      .on('zoom', (e: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        gMap.attr('transform', e.transform.toString())
        gHeat.attr('transform', e.transform.toString())
        gHotspots.attr('transform', e.transform.toString())
        setPopup(null)
      })
    svg.call(zoom)
    zoomRef.current = zoom

    setReady(true)
    return () => { svg.on('.zoom', null) }
  }, [])

  // Fly to continent on change
  useEffect(() => {
    const svgEl = svgRef.current
    const proj = projRef.current
    const zoom = zoomRef.current
    const container = containerRef.current
    if (!svgEl || !proj || !zoom || !container || !ready) return
    const W = container.clientWidth || 800
    const H = container.clientHeight || 440
    const view = CONTINENT_VIEWS[activeCont] ?? CONTINENT_VIEWS['global']!
    flyTo(d3.select(svgEl), zoom, proj, view.center, view.scale, W, H)
  }, [activeCont, ready])

  // Draw hotspots and heat
  useEffect(() => {
    const svgEl = svgRef.current
    const proj = projRef.current
    if (!svgEl || !proj || !ready) return

    const svg = d3.select(svgEl)
    const gHeat = svg.select<SVGGElement>('.g-heat')
    const gHotspots = svg.select<SVGGElement>('.g-hotspots')

    // Heat blobs
    gHeat.selectAll('*').remove()
    if (heatVisible) {
      const defs = svg.select<SVGDefsElement>('defs').empty()
        ? svg.insert('defs', ':first-child')
        : svg.select<SVGDefsElement>('defs')

      zones.forEach(z => {
        const coords = proj([z.map_lon, z.map_lat])
        if (!coords) return
        const filterId = `blur-${z.id.slice(0, 8)}`
        if (defs.select(`#${filterId}`).empty()) {
          const f = defs.append('filter').attr('id', filterId)
          f.append('feGaussianBlur').attr('stdDeviation', 18)
        }
        gHeat.append('circle')
          .attr('cx', coords[0]).attr('cy', coords[1])
          .attr('r', 30 + (z.events_24h ?? 0) * 2)
          .attr('fill', levelColor(z.level))
          .attr('opacity', 0.12)
          .attr('filter', `url(#${filterId})`)
      })
    }

    // Hotspots
    gHotspots.selectAll('*').remove()
    zones.forEach(z => {
      const coords = proj([z.map_lon, z.map_lat])
      if (!coords) return
      const [cx, cy] = coords
      const color = levelColor(z.level)
      const isActive = activeZoneId === z.id

      // Ping ring
      const ring = gHotspots.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', isActive ? 16 : 10)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', isActive ? 1.5 : 1)
        .attr('opacity', 0)

      function pingAnimation() {
        ring.attr('r', isActive ? 16 : 10).attr('opacity', isActive ? 0.8 : 0.6)
          .transition().duration(1800).ease(d3.easeQuadOut)
          .attr('r', isActive ? 28 : 20).attr('opacity', 0)
          .on('end', pingAnimation)
      }
      pingAnimation()

      // Dot
      gHotspots.append('circle')
        .attr('cx', cx).attr('cy', cy)
        .attr('r', isActive ? 6 : 4)
        .attr('fill', color)
        .attr('stroke', '#0d1520')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .on('click', (event: MouseEvent) => {
          event.stopPropagation()
          const transform = d3.zoomTransform(svgRef.current!)
          const [sx, sy] = transform.apply([cx, cy])
          setPopup({ zone: z, x: sx, y: sy })
          onZoneClick(z.id)
        })

      // Label
      if (isActive) {
        gHotspots.append('text')
          .attr('x', cx + 8).attr('y', cy - 8)
          .attr('fill', color)
          .attr('font-size', 9)
          .attr('font-family', 'IBM Plex Mono, monospace')
          .attr('pointer-events', 'none')
          .text(z.zone_code)
      }
    })
  }, [zones, activeZoneId, heatVisible, ready, onZoneClick])

  // Close popup on background click
  const handleSvgClick = () => setPopup(null)

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} onClick={handleSvgClick} />
      {popup && (
        <MapPopup
          zone={popup.zone}
          x={popup.x}
          y={popup.y}
          onOpen={() => onZoneClick(popup.zone.id)}
        />
      )}
    </div>
  )
}
