#pragma once

// The block's look on its plate: a declarative view.icon (tokenized primitives on a 5-grid).
#include <nlohmann/json.hpp>

namespace paperboat::toolkit::board {

// The indicator-lamp symbol: a circle with a cross. Its disc fills in the signal colour while
// the lamp is lit (`when: on`: the plate follows the block's latest value, 1 while lit).
inline nlohmann::json lamp_icon() {
  return nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"ellipse","x":25,"y":20,"w":50,"h":60,"when":"off"},{"t":"ellipse","x":25,"y":20,"w":50,"h":60,"fill":"signal","when":"on"},{"t":"line","p":[[35,35],[65,65]]},{"t":"line","p":[[65,35],[35,65]]}]})");
}

}  // namespace paperboat::toolkit::board
