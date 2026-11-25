// board/display.

#include "common.hpp"
#include "board/instruments_shared.hpp"

namespace paperboat::toolkit::board {

void add_display(Registry& registry) {
  auto display = monitor("display", "Display", "display", "Shows its latest value on the Board.");
  display.def.whole_vector = true;  // a readout shows the whole vector
  display.def.view = {.compact = true, .icon = nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"rect","x":5,"y":20,"w":90,"h":60,"corner":"sm","fill":"screen","stroke":"ink"},{"t":"text","x":50,"y":50,"s":"0.42","size":13,"font":"mono","stroke":"signal"}]})")};  // digits on a screen
  registry.add(std::move(display));
}

}  // namespace paperboat::toolkit::board
