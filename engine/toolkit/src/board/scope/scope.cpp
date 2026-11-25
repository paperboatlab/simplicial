// board/scope (#37)

#include "common.hpp"
#include "board/instruments_shared.hpp"

namespace paperboat::toolkit::board {

void add_scope(Registry& registry) {
  // A Scope (#37): several inputs (a, b… by its `inputs` count), each a channel; a vector
  // input is one channel per component. How it draws is the Board layout's, not params.
  auto scope = monitor("scope", "Scope", "scope", "Plots several signals over time to study: axes, zoom, cursors, triggers.");
  // A Scope plots numbers: a signal, or a whole vector as one channel per component. A
  // `broadcast` signal port is how a signal port also accepts a vector wire (block.hpp).
  scope.def.inputs = {{.id = "a", .type = "signal", .broadcast = true}, {.id = "b", .type = "signal", .broadcast = true}};
  scope.def.params = {{.id = "inputs", .default_value = 2.0}};
  scope.def.ports_from = "inputs";
  scope.def.whole_vector = true;       // a vector is one sample: a channel per component
  scope.def.sample_per_input = true;  // one sample per wired input, tagged with it
  scope.def.view = {.compact = true, .value = "{inputs} ch", .icon = nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"rect","x":5,"y":15,"w":60,"h":70,"corner":"sm","fill":"screen","stroke":"ink"},{"t":"line","p":[[10,50],[15,35],[20,30],[25,30],[30,35],[35,50],[40,65],[45,70],[50,70],[55,65],[60,50]],"stroke":"signal"},{"t":"ellipse","x":75,"y":20,"w":15,"h":20},{"t":"line","p":[[80,30],[85,25]],"weight":"thin"},{"t":"ellipse","x":75,"y":60,"w":15,"h":20},{"t":"line","p":[[85,70],[80,65]],"weight":"thin"}]})")};  // a screen and two knobs
  registry.add(std::move(scope));
}

}  // namespace paperboat::toolkit::board
