// board/graph.

#include "common.hpp"
#include "board/instruments_shared.hpp"

namespace paperboat::toolkit::board {

void add_graph(Registry& registry) {
  auto graph = monitor("graph", "Graph", "graph", "Plots its input over time on the Board.");
  graph.def.view = {.compact = true, .icon = nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"rect","x":5,"y":15,"w":90,"h":70,"corner":"sm","fill":"screen","stroke":"ink"},{"t":"line","p":[[15,70],[85,70]],"stroke":"muted","weight":"thin"},{"t":"line","p":[[15,50],[20,35],[25,30],[30,35],[35,40],[40,50],[45,55],[50,60],[55,55],[60,50],[65,45],[70,40],[75,40],[80,40],[85,45]],"stroke":"signal"}]})")};  // a trace on a screen
  registry.add(std::move(graph));
}

}  // namespace paperboat::toolkit::board
