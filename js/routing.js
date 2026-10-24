const CELL_SIZE = 100;
const WALK_METERS_PER_MINUTE = 75;
const SNAP_LIMIT_M = 60;
const EXCLUDED_KINDS = new Set(["motorway", "rail", "aerialway"]);

class MinHeap {
  values = [];

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (values[parent].cost <= value.cost) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const values = this.values;
    if (!values.length) return null;
    const first = values[0], last = values.pop();
    if (values.length) {
      let index = 0;
      while (index * 2 + 1 < values.length) {
        let child = index * 2 + 1;
        if (child + 1 < values.length && values[child + 1].cost < values[child].cost) child++;
        if (values[child].cost >= last.cost) break;
        values[index] = values[child];
        index = child;
      }
      values[index] = last;
    }
    return first;
  }
}

const nodeKey = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;
const cellKey = (x, z) => `${Math.floor(x / CELL_SIZE)}:${Math.floor(z / CELL_SIZE)}`;

export function buildWalkingGraph(roads = []) {
  const nodes = [];
  const nodeByKey = new Map();
  const grid = new Map();
  const getNode = (x, z) => {
    const key = nodeKey(x, z);
    if (nodeByKey.has(key)) return nodeByKey.get(key);
    const id = nodes.length;
    nodes.push({ id, x, z, edges: [] });
    nodeByKey.set(key, id);
    const cell = cellKey(x, z);
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(id);
    return id;
  };

  for (const road of roads) {
    if (!Array.isArray(road.p) || road.p.length < 4 || EXCLUDED_KINDS.has(road.c) || road.walk === false || road.walk === 0) continue;
    const stepFactor = road.hw === "steps" ? 1.8 : road.hw === "track" || road.c === "track" ? 1.15 : 1;
    for (let index = 0; index + 3 < road.p.length; index += 2) {
      const x1 = road.p[index], z1 = road.p[index + 1], x2 = road.p[index + 2], z2 = road.p[index + 3];
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (!Number.isFinite(length) || length < 0.1) continue;
      const from = getNode(x1, z1), to = getNode(x2, z2);
      const minutes = (length * stepFactor) / WALK_METERS_PER_MINUTE;
      nodes[from].edges.push({ to, length, minutes, roadId: road.id });
      nodes[to].edges.push({ to: from, length, minutes, roadId: road.id });
    }
  }

  return { nodes, grid, nodeCount: nodes.length };
}

export function closestWalkNode(graph, x, z, maxDistance = SNAP_LIMIT_M) {
  if (!graph?.nodes?.length || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const reach = Math.ceil(maxDistance / CELL_SIZE);
  const gx = Math.floor(x / CELL_SIZE), gz = Math.floor(z / CELL_SIZE);
  let best = null;
  for (let ix = gx - reach; ix <= gx + reach; ix++) for (let iz = gz - reach; iz <= gz + reach; iz++) {
    for (const id of graph.grid.get(`${ix}:${iz}`) ?? []) {
      const node = graph.nodes[id];
      const distance = Math.hypot(node.x - x, node.z - z);
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { id, distance };
    }
  }
  return best;
}

export function shortestWalkRoutes(graph, start, maxMinutes = Infinity) {
  const snapped = closestWalkNode(graph, start?.x, start?.z);
  if (!snapped) return null;
  const distances = new Float64Array(graph.nodes.length).fill(Infinity);
  const meters = new Float64Array(graph.nodes.length).fill(Infinity);
  const previous = new Array(graph.nodes.length);
  const queue = new MinHeap();
  distances[snapped.id] = 0;
  meters[snapped.id] = snapped.distance;
  queue.push({ id: snapped.id, cost: 0 });

  while (queue.values.length) {
    const current = queue.pop();
    if (current.cost !== distances[current.id] || current.cost > maxMinutes) continue;
    for (const edge of graph.nodes[current.id].edges) {
      const cost = current.cost + edge.minutes;
      if (cost > maxMinutes || cost >= distances[edge.to]) continue;
      distances[edge.to] = cost;
      meters[edge.to] = meters[current.id] + edge.length;
      previous[edge.to] = { id: current.id, edge };
      queue.push({ id: edge.to, cost });
    }
  }
  return { graph, startId: snapped.id, snapDistance: snapped.distance, distances, meters, previous, maxMinutes };
}

export function walkingRouteTo(search, target) {
  const snapped = closestWalkNode(search?.graph, target?.x, target?.z);
  if (!snapped || !Number.isFinite(search.distances[snapped.id])) return null;
  const ids = [snapped.id];
  while (ids[0] !== search.startId) {
    const previous = search.previous[ids[0]];
    if (!previous) return null;
    ids.unshift(previous.id);
  }
  const points = ids.map((id) => {
    const node = search.graph.nodes[id];
    return [node.x, node.z];
  });
  return {
    distanceM: Math.round(search.meters[snapped.id] + snapped.distance),
    minutes: Math.max(1, Math.round(search.distances[snapped.id] + snapped.distance / WALK_METERS_PER_MINUTE)),
    points,
    snappedDistanceM: Math.round(snapped.distance),
  };
}

export function walkingSegmentsWithin(search, maxMinutes) {
  if (!search) return [];
  const segments = [], seen = new Set();
  for (const node of search.graph.nodes) {
    const startMinutes = search.distances[node.id];
    if (startMinutes > maxMinutes) continue;
    for (const edge of node.edges) {
      const key = `${Math.min(node.id, edge.to)}:${Math.max(node.id, edge.to)}:${edge.roadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const remaining = maxMinutes - startMinutes;
      const fraction = Math.min(1, remaining / edge.minutes);
      if (fraction <= 0) continue;
      const a = node, b = search.graph.nodes[edge.to];
      segments.push([a.x, a.z, a.x + (b.x - a.x) * fraction, a.z + (b.z - a.z) * fraction]);
    }
  }
  return segments;
}