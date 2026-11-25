#pragma once

// Shared by several board blocks.

#include "common.hpp"

namespace paperboat::toolkit::board {

struct Passive final : Block {
  Values step(const Context&, const Values&) override { return {}; }
};

inline Template monitor(std::string type, std::string label, std::string instrument, std::string description) {
  Template t;
  t.name = "board/" + type;
  t.def = {.type = std::move(type), .label = std::move(label), .kind = Kind::Monitor, .inputs = {{"in", "any"}},
           .outputs = {}, .params = {}, .instrument = std::move(instrument), .description = std::move(description)};
  t.make = [](const Values&, const Config&) { return std::make_unique<Passive>(); };
  return t;
}

}  // namespace paperboat::toolkit::board
