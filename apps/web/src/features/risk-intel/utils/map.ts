export const CONTINENT_VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  global:   { center: [10, 15],   zoom: 1.3 },
  africa:   { center: [20, 2],    zoom: 3 },
  asia:     { center: [95, 30],   zoom: 2.6 },
  europe:   { center: [15, 50],   zoom: 3.2 },
  americas: { center: [-75, 10],  zoom: 2.4 },
  oceania:  { center: [140, -25], zoom: 3.2 },
  mideast:  { center: [45, 27],   zoom: 4 },
}
