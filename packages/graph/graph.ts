// i will implement dijkstra's algorithm here


import { PriorityQueue } from "./pQueue";
/**
 *
 * @param graph
 * @param numOfNodes
 * @param from is the node that we are starting from
 */

type PriorityDataType = { i: number; p: number };

const comparatorFunction = (a: PriorityDataType, b: PriorityDataType) =>
  a.p - b.p;

// const reconstructPath = (from: number, to: number, prev: number[]) => {
//   const reconstructed: number[] = [];
//   let count = 0;
//   for (let i = to; i != null; i = prev[i]!) {
//     if (count > prev.length) {
//       break;
//     }
//     reconstructed.push(i);
//     count++;
//   }
//   return reconstructed.reverse();
// };
const reconstructPath = (from: number, to: number, prev: number[]) => {
  const reconstructed: number[] = [];
  let current = to;
  let count = 0;

  // Follow prev pointers backwards
  while (current != null && count < prev.length) {
    reconstructed.push(current);

    // If we reached the start, we're done
    if (current === from) {
      return reconstructed.reverse();
    }

    current = prev[current];
    count++;
  }

  // If we get here, no path exists
  throw new Error(`No path found from ${from} to ${to}`);
};
// function reconstructPath(from: number, to: number, prev: number[]) {
//   const path = [];
//   let current = to;

//   // Walk backwards using prev pointers
//   while (current !== undefined) {
//     path.unshift(current);  // Add to front
//     current = prev[current]; // Move to parent
//     if (current === from) {
//       path.unshift(from);
//       break;
//     }
//   }
//   return path;
// }

const normalizeDecimals = (value: number, decimals: number): number => {
  return value / Math.pow(10, decimals);
};
export type FunctionToMutateTheEdgeCostType<T extends EdgeData> = (
  params: FunctionEdgeData,
  e: Edge<T>
) => number;



type FunctionEdgeData = EdgeData & { key: GraphKey };
type GraphKey = { key: number; keyRate: number; keyDecimal: number };
const dijkstraAlgorithmWithKey = (
  graph: Graph,
  from: number,
  to: number,
  key: GraphKey,
  functionToMutateTheEdgeCost: FunctionToMutateTheEdgeCostType<EdgeData>
) => {

  if (from > graph.length || to > graph.length)
    throw new Error("Start and/or end is out of bounds on graph");

  // console.log("from: ", from);
  // console.log("  to,: ", to);
  const queue = new PriorityQueue<PriorityDataType>(comparatorFunction);
  const visited = Array(graph.length).fill(false);
  const dist = Array(graph.length).fill(Infinity);
  const prev: number[] = [];
  // New array to store the edge used to update each node.
  const prevEdge: (Edge<EdgeData> | null)[] = new Array(graph.length).fill(
    null
  );

  // Ensure the starting node has at least one outgoing edge.
  if (graph[from].length === 0) {
    throw new Error("No edges from starting node");
  }
  // Enqueue the starting node.
  queue.enqueue({
    i: from,
    p: functionToMutateTheEdgeCost(
      { ...graph[from][0].edgeData, key },
      graph[from][0]
    ),
  });




  dist[from] = 0;

  while (!queue.isEmpty()) {
    const currentNode = queue.dequeue()!;
    // console.log('currentNode.i before : ', currentNode);
    // console.log('to: ', to);
    // console.log('currentNode aka best for now: ', graph[currentNode.i]);
    visited[currentNode.i] = true;

    for (let i = 0; i < graph[currentNode.i].length; i++) {
      const e = graph[currentNode.i][i];
      // Calculate cost for this edge.

      let cost = functionToMutateTheEdgeCost({ ...e.edgeData, key }, e);

      const nodeCost = dist[e.from] + cost;
      // console.log('nodeCost: ', nodeCost);

      // Relaxation step: update if a better path is found.

      // console.log("dist[e.to] : ", dist[e.to], "nodeCost", nodeCost);
      if (nodeCost < dist[e.to]) {
        dist[e.to] = nodeCost;
        prev[e.to] = e.from;
        prevEdge[e.to] = e; // store the edge used
      }
      // Enqueue the node if not already visited.
      if (!visited[e.to]) {
        queue.enqueue({
          i: e.to,
          p: cost,
        });
      }
      // console.log("============================================================================");
    }
    // If we've reached the destination, reconstruct the path.

    if (currentNode.i === to) {
      // console.log("prev: ", prev);
      const reconstructedPath = reconstructPath(from, to, prev);
      // console.log('reconstructedPath: ', reconstructedPath);
      // Reconstruct the list of edges corresponding to the path.
      const reconstructedEdges: Edge<EdgeData>[] = [];
      for (let i = 1; i < reconstructedPath.length; i++) {
        const node = reconstructedPath[i];
        if (!prevEdge[node]) {
          throw new Error("Missing edge data during path reconstruction");
        }
        reconstructedEdges.push(prevEdge[node]!);
      }
      return {
        distance: dist,
        reconstructedPath,
        reconstructedEdges,
      };
    }
  }

  console.log("Reached the end of the graph");
};

class Node {
  id: any;
  value: any;
  constructor(id: any, value: any) {
    this.id = id;
    this.value = value;
  }
}
export interface EdgeData {
  cost?: number;
  price: number;
  priceUsdc: number;
  tokenFromReserve?: number;
  tokenToReserve?: number;
  tokenFromDecimals: number;
  tokenToDecimals: number;
  dexId: any;
  poolAddress: string;
  aToB: boolean
  fee: number
}
export class Edge<T extends EdgeData> {
  from: any;
  to: any;
  edgeData: T;
  constructor(from: number, to: number, edgeData: T) {
    this.from = from;
    this.to = to;
    this.edgeData = edgeData;
  }
}

export type Graph<T extends EdgeData = EdgeData> = Edge<T>[][];



// getAndFormatThePoolsIntoGraphEdges().then((graph) => {
//   console.log("graph: ", graph);
//   const res = dijkstraAlgorithmWithKey(graph, 12, 7, 0);
//   console.log("res: ", res);
// });

/**
 * Modified findBestRouteIndex function to allow flexible route reduction
 */
export const findBestRouteIndex = <T extends EdgeData>(
  graph: Graph,
  fromIndex: number,
  toIndex: number,
  key: GraphKey,
  targetHops?: number,
  functionToMutateTheEdgeCost?: FunctionToMutateTheEdgeCostType<T>
) => {
  // Sanity check for an empty graph
  // console.log("graph: ", graph);
  // console.log("graph: ", typeof graph);
  // if (checkIfGraphIsEmpty(graph)) {
  //   console.log("graph: ", graph);
  //   throw new Error("Graph is empty");
  // }

  const func =
    (functionToMutateTheEdgeCost as FunctionToMutateTheEdgeCostType<EdgeData>)

  // console.log('graph: ', graph);
  // console.log('fromIndex: ', fromIndex);
  // console.log('toIndex: ', toIndex);
  // console.log('key: ', key);
  const result = dijkstraAlgorithmWithKey(graph, fromIndex, toIndex, key, func);

  // console.log("result: ", result);

  if (!result) {
    // console.log("====================================");
    // console.log(`Could not find ${fromIndex} ${toIndex}`);
    // console.log("====================================");
    return {
      bestOutcome: 100,
      bestRoute: [[]],
      edgeData: [],
    };
  }

  let cost: number;
  const cc = calculateTheCost(result.reconstructedPath, result.distance);
  cost = cc[cc.length - 1].cost;
  let finalResult = result.reconstructedPath;

  let finalEdges = result.reconstructedEdges;

  // If targetHops is specified and the route needs reduction
  if (targetHops !== undefined && finalResult.length - 1 > targetHops) {
    // console.log("====================================");
    // console.log("Reducing to Smaller number of hops");
    // console.log("====================================");
    try {
      const red = reduceRouteToTargetHops(
        finalResult,
        targetHops,
        graph,
        key,
        func
      );
      finalResult = red.finalRoute;
      cost = red.bestOutcome;
      finalEdges = red.finalEdges;
    } catch (error) {
      console.warn(`Route reduction failed: ${(error as Error).message}`);
      // Continue with the original route if reduction fails
    }
  }

  return {
    bestOutcome: cost,
    bestRoute: convertPathToPair(finalResult),
    edgeData: finalEdges,
  };
};

const calculateTheCost = (path: number[], dist: number[]) => {
  let currentCost = 0;
  let pairCost = [];

  for (let i = 1; i < path.length; i++) {
    const cost = dist[path[i]];

    pairCost.push({
      from: path[i - 1],
      to: path[i],
      cost: cost,
    });
  }

  return pairCost;
};

export const checkIfGraphIsEmpty = (graph: Graph) => {
  if (!graph || graph.length < 1) return true;
  //check if at least halve of the graph nodes are not empty
  const half = Math.floor(graph.length / 4);
  let nonEmptyNodes = 0;
  for (let i = 0; i < graph.length; i++) {
    if (graph[i].length > 0) nonEmptyNodes++;
    if (nonEmptyNodes > half) return false;

  }
  return true;
};

const convertPathToPair = (path: number[]) => {
  const pairs = [];
  for (let i = 0; i < path.length - 1; i++) {
    pairs.push([path[i], path[i + 1]]);
  }
  return pairs;
};

/**
 * Simulates a swap across multiple connected edges
 * @param nodes An array of connected node indices
 * @param initialKey The initial input amount/key for the swap
 * @param graph The graph data structure
 * @param functionToMutateTheEdgeCost The cost function
 * @returns The total cost and edges used
 */
function simulateMultiStepSwap(
  nodes: number[],
  initialKey: GraphKey,
  graph: Graph,
  functionToMutateTheEdgeCost: FunctionToMutateTheEdgeCostType<EdgeData>
): { totalCost: number; edges: Edge<EdgeData>[] } {
  // let currentKey = initialKey;
  let totalCost = 0;
  const edges: Edge<EdgeData>[] = [];

  // Process each pair of consecutive nodes
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];

    // Find the edge between these nodes
    const edge = graph[from].find((e) => e.to === to);
    if (!edge) {
      throw new Error(`No edge from ${from} to ${to}`);
    }

    // Compute the cost for this edge
    const result = functionToMutateTheEdgeCost(
      { ...edge.edgeData, key: initialKey },
      edge
    );

    // Update running total and save the edge
    totalCost += result;
    edges.push(edge);

    // Update key for next edge if there is one
    // if (i < nodes.length - 2) {
    //   currentKey = { key: result, keyRate: initialKey.keyRate };
    // }
  }

  return { totalCost, edges };
}

/**
 * Reduces a route by one hop, finding the optimal reduction
 * @param route An array of node indices (e.g. [A, B, C, D])
 * @param graph The graph data structure
 * @param key The initial input amount for the swap
 * @param functionToMutateTheEdgeCost The cost function
 * @returns A new route with one fewer hop, along with the best outcome and the edges
 */
function reduceRouteByOneHop(
  route: number[],
  graph: Graph,
  key: GraphKey,
  functionToMutateTheEdgeCost: FunctionToMutateTheEdgeCostType<EdgeData>
): { finalRoute: number[]; bestOutcome: number; finalEdges: Edge<EdgeData>[] } {
  // Ensure that the route has at least four nodes (to reduce to three)
  if (route.length < 4) {
    throw new Error(
      "Route must contain at least four nodes to reduce by one hop."
    );
  }

  const start = route[0];
  const end = route[route.length - 1];

  let bestRoute: number[] = [];
  let bestOutcome: number = Infinity;
  let bestEdges: Edge<EdgeData>[] = [];

  // Try removing each intermediate node
  for (let i = 1; i < route.length - 1; i++) {
    // Create a candidate route by removing the current node
    const candidateRoute = [...route];
    candidateRoute.splice(i, 1);

    try {
      // Simulate this reduced route
      const { totalCost, edges } = simulateMultiStepSwap(
        candidateRoute,
        key,
        graph,
        functionToMutateTheEdgeCost
      );

      // Update if a better (lower cost) candidate is found
      if (totalCost < bestOutcome) {
        bestOutcome = totalCost;
        bestRoute = candidateRoute;
        bestEdges = edges;
      }
    } catch (error) {
      // If this candidate fails (e.g., missing edge), try the next one
      console.warn(
        `Skipping candidate route without node ${route[i]}: ${(error as Error).message
        }`
      );
      continue;
    }
  }

  if (bestRoute.length === 0) {
    throw new Error("No valid reduced route found.");
  }

  return { finalRoute: bestRoute, bestOutcome, finalEdges: bestEdges };
}

/**
 * Reduces a route to the requested number of hops, if possible
 * @param route An array of node indices
 * @param targetHops The desired number of hops (nodes - 1)
 * @param graph The graph data structure
 * @param key The initial input amount for the swap
 * @param functionToMutateTheEdgeCost The cost function
 * @returns A new route with the target number of hops, along with the best outcome and edges
 */
function reduceRouteToTargetHops(
  route: number[],
  targetHops: number,
  graph: Graph,
  key: GraphKey,
  functionToMutateTheEdgeCost: FunctionToMutateTheEdgeCostType<EdgeData>
): { finalRoute: number[]; bestOutcome: number; finalEdges: Edge<EdgeData>[] } {
  // Validate input
  if (targetHops < 1) {
    throw new Error("Target hops must be at least 1");
  }

  const currentHops = route.length - 1;

  if (targetHops >= currentHops) {
    // No reduction needed
    const { totalCost, edges } = simulateMultiStepSwap(
      route,
      key,
      graph,
      functionToMutateTheEdgeCost
    );
    return { finalRoute: route, bestOutcome: totalCost, finalEdges: edges };
  }

  // If the target is exactly 2 hops, use the existing optimized function
  if (targetHops === 2) {
    return reduceRouteToTwoHops(route, graph, key, functionToMutateTheEdgeCost);
  }

  // For other cases, iteratively reduce one hop at a time
  let currentRoute = [...route];
  let result: {
    finalRoute: number[];
    bestOutcome: number;
    finalEdges: Edge<EdgeData>[];
  };

  // Reduce one hop at a time until we reach the target
  while (currentRoute.length - 1 > targetHops) {
    result = reduceRouteByOneHop(
      currentRoute,
      graph,
      key,
      functionToMutateTheEdgeCost
    );
    currentRoute = result.finalRoute;
  }

  // At this point, result must be defined because we've reduced at least once
  return {
    finalRoute: currentRoute,
    bestOutcome: result!.bestOutcome,
    finalEdges: result!.finalEdges,
  };
}

// Modified simulateTwoStepSwap to return both cost and edges.
function simulateTwoStepSwap(
  start: number,
  intermediary: number,
  end: number,
  initialKey: GraphKey,
  graph: Graph,
  functionToMutateTheEdgeCost: FunctionToMutateTheEdgeCostType<EdgeData>
): { totalCost: number; edges: Edge<EdgeData>[] } {
  // Find the edge from start to intermediary.
  const edge1 = graph[start].find((e) => e.to === intermediary);
  if (!edge1) {
    throw new Error(`No edge from ${start} to ${intermediary}`);
  }
  // Compute the result of the first swap.
  const result1 = functionToMutateTheEdgeCost(
    { ...edge1.edgeData, key: initialKey },
    edge1
  );
  // Find the edge from intermediary to end.
  const edge2 = graph[intermediary].find((e) => e.to === end);
  if (!edge2) {
    throw new Error(`No edge from ${intermediary} to ${end}`);
  }
  // Compute the result of the second swap using result1 as the new key.

  //!NOT SURE ABOUT THE KEY RATE BEING THE INITIAL VALUES OWN
  const result2 = functionToMutateTheEdgeCost(
    {
      ...edge2.edgeData,
      key: {
        key: result1,
        keyRate: initialKey.keyRate,
        keyDecimal: initialKey.keyDecimal,
      },
    },
    edge2
  );
  // Return both the total cost and the two edges used.
  return { totalCost: result1 + result2, edges: [edge1, edge2] };
}

/**
 * Reduces a multi-hop best route to a two-hop route.
 *
 * @param route An array of node indices (e.g. [A, B, C, D]).
 * @param graph The graph data structure.
 * @param key The initial input amount for the swap.
 * @param functionToMutateTheEdgeCost Your cost function.
 * @returns A new route in the form [start, bestIntermediary, end], along with the best outcome and the corresponding edges.
 */

function reduceRouteToTwoHops(
  route: number[],
  graph: Graph,
  key: GraphKey,
  functionToMutateTheEdgeCost: FunctionToMutateTheEdgeCostType<EdgeData>
): { finalRoute: number[]; bestOutcome: number; finalEdges: Edge<EdgeData>[] } {
  // Ensure that the route has at least three nodes.
  if (route.length < 3) {
    throw new Error(
      "Route must contain at least three nodes (start, intermediary, end)."
    );
  }

  const start = route[0];
  const end = route[route.length - 1];

  let bestCandidate: number | null = null;
  let bestOutcome: number = Infinity;
  let bestEdges: Edge<EdgeData>[] = [];

  // Try each intermediate node (all nodes between start and end).
  for (let i = 1; i < route.length - 1; i++) {
    const candidate = route[i];
    try {
      const { totalCost, edges } = simulateTwoStepSwap(
        start,
        candidate,
        end,
        key,
        graph,
        functionToMutateTheEdgeCost
      );
      // Update if a better (lower cost) candidate is found.
      if (totalCost < bestOutcome) {
        bestOutcome = totalCost;
        bestCandidate = candidate;
        bestEdges = edges;
      }
    } catch (error) {
      console.warn(
        `Skipping candidate ${candidate}: ${(error as Error).message}`
      );
      continue;
    }
  }

  if (bestCandidate === null) {
    throw new Error("No valid two-hop route found from the given route.");
  }
  const finalRoute = [start, bestCandidate, end];

  return { finalRoute, bestOutcome, finalEdges: bestEdges };
}
